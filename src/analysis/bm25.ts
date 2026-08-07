import type { Corpus, IndexedSkill } from './corpus.ts';
import type { TermContribution } from '../types.ts';

/**
 * BM25F scoring over the two routing fields.
 *
 * BM25F rather than plain BM25 because the routing surface is genuinely
 * structured. Concatenating a three-word name onto a sixty-word description
 * would let the name's terms be diluted by description length normalisation,
 * even though the name is the strongest available signal about what a skill is
 * for. BM25F normalises each field by its own average length, combines the
 * results with per-field weights, and only then applies term-frequency
 * saturation — which is the correct order of operations, and not something you
 * can fake by repeating name tokens into a single field.
 */

export interface ScoringParameters {
  /**
   * Term-frequency saturation. Higher values keep rewarding repetition longer.
   * `1.2` is the standard information-retrieval default and is kept here
   * because repeating a word in a skill description should help a little and
   * then stop helping — which is exactly what saturation encodes.
   */
  readonly k1: number;
  /** Length normalisation for the name field, in `[0, 1]`. */
  readonly nameLengthNormalisation: number;
  /** Length normalisation for the description field, in `[0, 1]`. */
  readonly descriptionLengthNormalisation: number;
  /**
   * Weight of a term occurring in the skill name.
   *
   * Names are short, deliberate, and human-chosen; a match there is much more
   * likely to reflect real intent than a match in prose. The default of `2.5`
   * means a name hit counts for roughly two and a half description hits.
   */
  readonly nameWeight: number;
  /** Weight of a term occurring in the description. */
  readonly descriptionWeight: number;
}

export const DEFAULT_SCORING: ScoringParameters = {
  k1: 1.2,
  nameLengthNormalisation: 0.35,
  descriptionLengthNormalisation: 0.75,
  nameWeight: 2.5,
  descriptionWeight: 1,
};

export interface ScoreBreakdown {
  readonly score: number;
  readonly contributions: readonly TermContribution[];
}

/**
 * Field-normalised, weighted term frequency — the `f̃` of the BM25F formulation.
 *
 * Note the name field uses a lower normalisation constant by default. Skill
 * names cluster tightly around two or three words, so aggressive length
 * normalisation there mostly amplifies noise; descriptions vary from eight
 * words to a hundred and fifty, where it does real work.
 */
function weightedFrequency(document: IndexedSkill, corpus: Corpus, term: string, params: ScoringParameters): number {
  const nameFrequency = document.name.frequencies.get(term) ?? 0;
  const descriptionFrequency = document.description.frequencies.get(term) ?? 0;

  if (nameFrequency === 0 && descriptionFrequency === 0) return 0;

  let total = 0;

  if (nameFrequency > 0) {
    const norm = (1 - params.nameLengthNormalisation)
      + params.nameLengthNormalisation * (document.name.length / corpus.averageNameLength);
    total += (params.nameWeight * nameFrequency) / Math.max(norm, Number.EPSILON);
  }

  if (descriptionFrequency > 0) {
    const norm = (1 - params.descriptionLengthNormalisation)
      + params.descriptionLengthNormalisation * (document.description.length / corpus.averageDescriptionLength);
    total += (params.descriptionWeight * descriptionFrequency) / Math.max(norm, Number.EPSILON);
  }

  return total;
}

/**
 * Score one skill against a set of query terms and record why.
 *
 * Every scored term is retained with its contribution and document frequency,
 * because "this skill won" is far less useful than "this skill won on the word
 * `invoice`, and the word `data` you were relying on is in 41 other skills".
 */
export function scoreDocument(
  document: IndexedSkill,
  corpus: Corpus,
  queryTerms: readonly string[],
  params: ScoringParameters = DEFAULT_SCORING,
): ScoreBreakdown {
  const contributions: TermContribution[] = [];
  const seen = new Set<string>();
  let score = 0;

  for (const term of queryTerms) {
    if (seen.has(term)) continue;
    seen.add(term);

    const frequency = weightedFrequency(document, corpus, term, params);
    if (frequency === 0) continue;

    const weight = corpus.idf(term) * (frequency / (params.k1 + frequency));
    if (weight <= 0) continue;

    score += weight;
    contributions.push({
      term,
      surface: corpus.surfaceOf(term),
      weight,
      documentFrequency: corpus.documentFrequency(term),
    });
  }

  contributions.sort((a, b) => b.weight - a.weight);
  return { score, contributions };
}
