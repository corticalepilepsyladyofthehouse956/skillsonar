import { uniqueTerms, type TokenizeOptions } from '../text/tokenize.ts';
import { scoreDocument, DEFAULT_SCORING, type ScoringParameters } from './bm25.ts';
import type { Corpus, IndexedSkill } from './corpus.ts';
import type { RoutingResult, RoutingVerdict, SkillScore, TermContribution } from '../types.ts';

/**
 * Thresholds that turn a continuous score gap into a verdict.
 *
 * These are calibrated heuristics, not measurements of any particular model,
 * and the tool says so wherever it reports them. The reasoning behind the
 * defaults:
 *
 * A language model choosing between skills is not running BM25. What it is
 * doing, though, is discriminating between short texts on the basis of their
 * overlap with a request — and when two texts are lexically near-identical,
 * *no* selection mechanism can reliably tell them apart, because the
 * information needed to choose is absent from the input. That is the class of
 * problem this tool detects: not "the model will pick wrong", but "the model
 * has not been given enough to pick right".
 *
 * A large gap is therefore weak evidence of correct routing, while a near-zero
 * gap is strong evidence of a genuine defect. The thresholds are deliberately
 * set so that findings are conservative: `ambiguous` fires only when the top
 * two are within ten percent of each other.
 */
export interface RoutingThresholds {
  /** Below this relative gap the top two skills are indistinguishable. */
  readonly ambiguousMargin: number;
  /** Below this relative gap the decision is fragile but leaning. */
  readonly contestedMargin: number;
  /**
   * Minimum share of a query's available discriminative weight the top skill
   * must capture before the match counts as meaningful. See
   * {@link queryCeiling} for why this is a share rather than a raw score.
   */
  readonly minimumCoverage: number;
}

export const DEFAULT_THRESHOLDS: RoutingThresholds = {
  ambiguousMargin: 0.1,
  contestedMargin: 0.3,
  minimumCoverage: 0.15,
};

/**
 * The highest score any skill could possibly achieve for this query: the sum of
 * its terms' IDF, which BM25 saturation approaches but never reaches.
 *
 * "Did anything actually match" cannot be answered with a fixed score
 * threshold, because BM25 scores have no absolute scale. IDF depends on corpus
 * size, so the same perfect match scores 0.33 in a two-skill collection and 12
 * in a two-hundred-skill one. A fixed floor of 0.35 declares the two-skill
 * corpus a no-match while accepting a single incidental word in the large one —
 * exactly backwards.
 *
 * Dividing by the ceiling makes the test scale-free: it asks what fraction of
 * the query's available discriminative weight the winner captured, which means
 * the same threshold behaves correctly at every collection size.
 */
function queryCeiling(corpus: Corpus, terms: readonly string[]): number {
  let total = 0;
  for (const term of terms) total += corpus.idf(term);
  return total;
}

export interface RouteOptions {
  readonly scoring?: ScoringParameters;
  readonly thresholds?: RoutingThresholds;
  readonly tokenize?: TokenizeOptions;
  /** Cap the ranked list. Defaults to unlimited. */
  readonly limit?: number;
}

/**
 * Relative gap between the top two scores.
 *
 * Relative rather than absolute, because raw BM25F scores have no fixed scale:
 * a gap of 2.0 is decisive in a corpus scoring around 3 and negligible in one
 * scoring around 40. Dividing by the top score makes the number comparable
 * across corpora, which is what allows a single default threshold to work.
 */
function relativeMargin(top: number, runnerUp: number | undefined): number {
  if (top <= 0) return 0;
  if (runnerUp === undefined) return 1;
  return Math.max(0, Math.min(1, (top - runnerUp) / top));
}

function verdictFor(
  coverage: number,
  margin: number,
  thresholds: RoutingThresholds,
): RoutingVerdict {
  if (coverage < thresholds.minimumCoverage) return 'no-match';
  if (margin < thresholds.ambiguousMargin) return 'ambiguous';
  if (margin < thresholds.contestedMargin) return 'contested';
  return 'confident';
}

/** Rank every skill in the corpus against a natural-language query. */
export function route(corpus: Corpus, query: string, options: RouteOptions = {}): RoutingResult {
  const scoring = options.scoring ?? DEFAULT_SCORING;
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const terms = uniqueTerms(query, options.tokenize);

  const ranked: SkillScore[] = [];
  for (const document of corpus.documents) {
    const breakdown = scoreDocument(document, corpus, terms, scoring);
    if (breakdown.score <= 0) continue;
    ranked.push({
      skill: document.skill,
      score: breakdown.score,
      contributions: breakdown.contributions,
    });
  }

  // Ties break on skill id so that two identically-scoring skills always report
  // in the same order. Without this, CI output would flip between runs on
  // filesystems that enumerate differently, and the tool would be undiffable.
  ranked.sort((a, b) => (b.score - a.score) || a.skill.id.localeCompare(b.skill.id));

  const margin = relativeMargin(ranked[0]?.score ?? 0, ranked[1]?.score);

  const ceiling = queryCeiling(corpus, terms);
  const coverage = ceiling === 0 ? 0 : (ranked[0]?.score ?? 0) / ceiling;
  const verdict = verdictFor(coverage, margin, thresholds);

  const limited = options.limit === undefined ? ranked : ranked.slice(0, options.limit);
  return { query, ranked: limited, margin, coverage, verdict };
}

/**
 * The terms that most distinguish a skill from the rest of the corpus.
 *
 * Ranked by IDF weighted by field placement: a term in the name outranks the
 * same term in the description. These are the words the skill is actually
 * "claiming" — the ones an agent could use to tell it apart from its
 * neighbours.
 */
export function signatureTerms(
  document: IndexedSkill,
  corpus: Corpus,
  limit = 8,
): readonly TermContribution[] {
  const scored: TermContribution[] = [];

  for (const term of document.terms) {
    const inName = document.name.frequencies.has(term);
    const idf = corpus.idf(term);
    scored.push({
      term,
      surface: corpus.surfaceOf(term),
      weight: idf * (inName ? 1.5 : 1),
      documentFrequency: corpus.documentFrequency(term),
    });
  }

  scored.sort((a, b) => (b.weight - a.weight) || a.term.localeCompare(b.term));
  return scored.slice(0, limit);
}

export interface SelfProbe {
  readonly document: IndexedSkill;
  /** The query built from the skill's own signature terms. */
  readonly probe: string;
  readonly result: RoutingResult;
  /** True when the skill wins the query assembled from its own strongest terms. */
  readonly winsOwnProbe: boolean;
  /** The skill that won instead, when `winsOwnProbe` is false. */
  readonly stolenBy?: string;
}

/**
 * Ask whether a skill can win a query built from its own most distinctive words.
 *
 * This is the sharpest collision signal the tool has, and it needs no test
 * corpus, no model, and no user input. If a skill cannot win on the terms it
 * itself claims most strongly, then no realistic phrasing of that skill's own
 * job will route to it either — a neighbour will always be a better lexical
 * match. Unlike a similarity score, which requires interpreting a number, this
 * produces a fact: skill A loses its own signature query to skill B.
 */
export function selfProbe(
  document: IndexedSkill,
  corpus: Corpus,
  options: RouteOptions = {},
  termCount = 6,
): SelfProbe {
  const signature = signatureTerms(document, corpus, termCount);
  const probe = signature.map((entry) => entry.surface).join(' ');

  // `noStemming` because signature surfaces come straight from the index and
  // are already normalised; stemming them a second time is a no-op at best and
  // an over-reduction at worst.
  const result = route(corpus, probe, {
    ...options,
    tokenize: { ...options.tokenize, noStemming: false },
  });

  const winner = result.ranked[0];
  const winsOwnProbe = winner === undefined || winner.skill.id === document.skill.id;

  return {
    document,
    probe,
    result,
    winsOwnProbe,
    ...(winsOwnProbe ? {} : { stolenBy: winner?.skill.name }),
  };
}
