import { DEFAULT_SCORING, scoreDocument, type ScoringParameters } from './bm25.ts';
import { selfProbe, type RouteOptions, type SelfProbe } from './router.ts';
import type { Corpus, IndexedSkill } from './corpus.ts';
import type { TermContribution } from '../types.ts';

/**
 * Pairwise collision detection.
 *
 * Two skills collide when a routing layer cannot reliably distinguish them.
 * Everything here is computed over *routing response vectors*: for each term,
 * the score a skill would receive if that single term were the entire query.
 * Comparing responses rather than raw text is what makes the number mean
 * something — two skills can share most of their words and still be perfectly
 * distinguishable if the words they do not share are the rare ones, and
 * response vectors capture that because IDF has already flattened the common
 * terms toward zero.
 *
 * The measure itself is *contested mass*, not cosine similarity, and the
 * difference is not cosmetic. Cosine is symmetric and punishes a skill for
 * having extra vocabulary, so a thorough description that fully contains a
 * vague one scores as only loosely similar — while in practice the vague skill
 * is completely shadowed and can never win. Cosine reported 41% for exactly
 * that case in this project's own test corpus, on a pair the router then split
 * by an 8% margin: a severe collision reported as mild.
 *
 * Contested mass asks the question that actually matters, in one direction at a
 * time: of the routing weight this skill claims, how much does the other skill
 * also claim? A skill whose every term is matched or beaten by a neighbour is
 * fully contested regardless of how much extra vocabulary that neighbour has.
 * The pair is then scored by its worse direction, because a collision that
 * strands one of the two is still a collision.
 */

export interface Collision {
  /** The more contested of the two skills — the one at greater risk of never firing. */
  readonly a: IndexedSkill;
  readonly b: IndexedSkill;
  /**
   * Fraction of `a`'s routing mass also claimed by `b`, in `[0, 1]`.
   * This is the worse of the two directions, so `a` is always the loser.
   */
  readonly similarity: number;
  /** Fraction of `b`'s routing mass also claimed by `a`. */
  readonly reverseSimilarity: number;
  /** Terms driving the overlap, strongest first. */
  readonly sharedTerms: readonly TermContribution[];
  /** Terms unique to `a` — the material available to disambiguate it. */
  readonly uniqueToA: readonly string[];
  /** Terms unique to `b`. */
  readonly uniqueToB: readonly string[];
  readonly severity: CollisionSeverity;
}

export type CollisionSeverity = 'critical' | 'high' | 'moderate';

export interface CollisionThresholds {
  readonly critical: number;
  readonly high: number;
  readonly moderate: number;
}

/**
 * Calibrated against corpora where the router's own verdict is known.
 *
 * `critical` sits at 0.75 because above roughly three quarters contested, the
 * remaining unique vocabulary is too thin to survive paraphrasing: a user who
 * words their request slightly differently loses the distinguishing term
 * entirely. Below 0.4 the skills reliably separate, so reporting there would be
 * noise.
 */
export const DEFAULT_COLLISION_THRESHOLDS: CollisionThresholds = {
  critical: 0.75,
  high: 0.55,
  moderate: 0.4,
};

type ResponseVector = ReadonlyMap<string, number>;

/**
 * Build the routing response vector for one skill.
 *
 * Each component is that skill's BM25F score for a single-term query, so the
 * vector answers "how strongly does this skill respond to each word in the
 * vocabulary". Terms absent from the skill score zero and are omitted, keeping
 * the vectors sparse — the whole analysis stays linear in total corpus size
 * rather than in vocabulary size.
 */
function responseVector(
  document: IndexedSkill,
  corpus: Corpus,
  scoring: ScoringParameters,
): ResponseVector {
  const vector = new Map<string, number>();

  for (const term of document.terms) {
    const { score } = scoreDocument(document, corpus, [term], scoring);
    if (score > 0) vector.set(term, score);
  }

  return vector;
}

/**
 * Fraction of `subject`'s routing mass that `rival` also claims.
 *
 * Each term contributes `min(subject, rival)` — the weight the two genuinely
 * contest. Capping at the subject's own weight keeps the result in `[0, 1]` and
 * makes it conservative: a rival that scores *higher* on a term is not merely
 * contesting it but winning it outright, and this measure still counts that as
 * a tie. Underreporting is the right direction to err in for a check that
 * blocks builds.
 */
function contestedMass(subject: ResponseVector, rival: ResponseVector): number {
  let contested = 0;
  let total = 0;

  for (const [term, weight] of subject) {
    total += weight;
    const other = rival.get(term);
    if (other !== undefined) contested += Math.min(weight, other);
  }

  return total === 0 ? 0 : contested / total;
}

function severityFor(similarity: number, thresholds: CollisionThresholds): CollisionSeverity | null {
  if (similarity >= thresholds.critical) return 'critical';
  if (similarity >= thresholds.high) return 'high';
  if (similarity >= thresholds.moderate) return 'moderate';
  return null;
}

export interface CollisionOptions {
  readonly scoring?: ScoringParameters;
  readonly thresholds?: CollisionThresholds;
  /** Cap on returned pairs, strongest first. Defaults to `50`. */
  readonly limit?: number;
}

export interface CollisionReport {
  readonly collisions: readonly Collision[];
  /** Self-probe outcome for every skill, in corpus order. */
  readonly probes: readonly SelfProbe[];
  /** Skills that lose a query built from their own strongest terms. */
  readonly stolen: readonly SelfProbe[];
}

/**
 * Compare every pair of skills and probe each one against the whole corpus.
 *
 * Pair comparison is O(n²) in the number of skills, which is the right
 * trade-off for this domain: collections run to tens or low hundreds of skills,
 * and an exact answer on 200 skills costs under a second. Approximate
 * neighbour search would add a dependency and an error term to save time
 * nobody is spending.
 */
export function findCollisions(corpus: Corpus, options: CollisionOptions = {}): CollisionReport {
  const scoring = options.scoring ?? DEFAULT_SCORING;
  const thresholds = options.thresholds ?? DEFAULT_COLLISION_THRESHOLDS;
  const limit = options.limit ?? 50;

  const vectors = corpus.documents.map((document) => responseVector(document, corpus, scoring));
  const collisions: Collision[] = [];

  for (let i = 0; i < corpus.documents.length; i += 1) {
    for (let j = i + 1; j < corpus.documents.length; j += 1) {
      const first = corpus.documents[i] as IndexedSkill;
      const second = corpus.documents[j] as IndexedSkill;
      const firstVector = vectors[i] as ResponseVector;
      const secondVector = vectors[j] as ResponseVector;

      const forward = contestedMass(firstVector, secondVector);
      const reverse = contestedMass(secondVector, firstVector);

      // Orient the pair so `a` is always the more contested skill: the one a
      // reader needs to fix, and the one at risk of never firing.
      const swap = reverse > forward;
      const a = swap ? second : first;
      const b = swap ? first : second;
      const similarity = swap ? reverse : forward;
      const reverseSimilarity = swap ? forward : reverse;

      const severity = severityFor(similarity, thresholds);
      if (severity === null) continue;

      const shared: TermContribution[] = [];
      const uniqueToA: string[] = [];
      const uniqueToB: string[] = [];

      for (const term of a.terms) {
        if (b.terms.has(term)) {
          shared.push({
            term,
            surface: corpus.surfaceOf(term),
            weight: corpus.idf(term),
            documentFrequency: corpus.documentFrequency(term),
          });
        } else {
          uniqueToA.push(corpus.surfaceOf(term));
        }
      }
      for (const term of b.terms) {
        if (!a.terms.has(term)) uniqueToB.push(corpus.surfaceOf(term));
      }

      shared.sort((x, y) => (y.weight - x.weight) || x.term.localeCompare(y.term));
      uniqueToA.sort();
      uniqueToB.sort();

      collisions.push({
        a, b, similarity, reverseSimilarity, sharedTerms: shared, uniqueToA, uniqueToB, severity,
      });
    }
  }

  collisions.sort((x, y) => (y.similarity - x.similarity)
    || x.a.skill.id.localeCompare(y.a.skill.id)
    || x.b.skill.id.localeCompare(y.b.skill.id));

  const routeOptions: RouteOptions = { scoring };
  const probes = corpus.documents.map((document) => selfProbe(document, corpus, routeOptions));

  return {
    collisions: collisions.slice(0, limit),
    probes,
    stolen: probes.filter((probe) => !probe.winsOwnProbe),
  };
}

/** Skills whose entire routing surface is made of terms the corpus shares widely. */
export interface WeakSignal {
  readonly document: IndexedSkill;
  /** Highest IDF found anywhere in the skill's routing surface. */
  readonly bestIdf: number;
  /** Fraction of the corpus that shares the skill's rarest term. */
  readonly spread: number;
}

/**
 * Smallest collection in which "no distinguishing vocabulary" is a meaningful
 * claim.
 *
 * Below this, a term appearing in half the skills means it appears in two of
 * them, which says nothing about whether the skill is selectable.
 */
const MINIMUM_CORPUS_FOR_WEAK_SIGNAL = 5;

/**
 * Find skills with no distinguishing vocabulary at all.
 *
 * A skill whose rarest word still appears in most of the collection has nothing
 * to win on. This is distinct from a collision: the skill is not competing with
 * one neighbour, it is invisible against everything, and no amount of editing a
 * *different* skill will fix it.
 *
 * The test is the *spread* of the skill's rarest term — the fraction of the
 * collection sharing it — rather than that term's IDF. An absolute IDF floor
 * looks equivalent and is not: IDF is a function of collection size, so in a
 * three-skill collection a term unique to one skill scores only 0.98, and a
 * floor of 1.0 flags every perfectly distinct skill in the set. Spread is a
 * ratio and therefore means the same thing at any size.
 */
export function findWeakSignals(
  corpus: Corpus,
  maximumSpread = 0.5,
): readonly WeakSignal[] {
  if (corpus.size < MINIMUM_CORPUS_FOR_WEAK_SIGNAL) return [];

  const weak: WeakSignal[] = [];

  for (const document of corpus.documents) {
    if (document.terms.size === 0) continue;

    // The skill's rarest term is the best case it has for being selected.
    let rarest = Number.POSITIVE_INFINITY;
    let bestIdf = 0;
    for (const term of document.terms) {
      const frequency = corpus.documentFrequency(term);
      if (frequency < rarest) {
        rarest = frequency;
        bestIdf = corpus.idf(term);
      }
    }

    const spread = rarest / corpus.size;
    if (spread > maximumSpread) weak.push({ document, bestIdf, spread });
  }

  return weak.sort((a, b) => (b.spread - a.spread) || a.document.skill.id.localeCompare(b.document.skill.id));
}
