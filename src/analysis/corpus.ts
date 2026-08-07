import { tokenize, termFrequencies, surfaceForms, type Token, type TokenizeOptions } from '../text/tokenize.ts';
import type { Skill } from '../types.ts';

/**
 * The corpus indexes the *routing surface* only: a skill's `name` and
 * `description`.
 *
 * This is the single most important modelling decision in the tool, and it is
 * not an approximation. Agent Skills use progressive disclosure — at startup an
 * agent loads only the name and description of each installed skill, and
 * decides from those alone whether to read the body. The body may be five
 * hundred lines of excellent instructions; it contributes nothing to whether
 * the skill is ever selected.
 *
 * Indexing the body would therefore produce an analysis of a decision the agent
 * never makes. Skills that appear well-differentiated because their bodies
 * differ would be reported as safe while colliding in production.
 *
 * Name and description are indexed as separate fields rather than concatenated,
 * so BM25F can weight them independently. A term in a three-word name is a far
 * stronger signal than the same term buried in a sixty-word description.
 */

export interface FieldIndex {
  readonly frequencies: ReadonlyMap<string, number>;
  /** Token count after stop-word removal. */
  readonly length: number;
}

export interface IndexedSkill {
  readonly skill: Skill;
  readonly name: FieldIndex;
  readonly description: FieldIndex;
  /** Every distinct term across both fields. */
  readonly terms: ReadonlySet<string>;
  readonly tokens: readonly Token[];
}

export interface Corpus {
  readonly documents: readonly IndexedSkill[];
  readonly size: number;
  /** Mean name-field length across the corpus, floored at 1. */
  readonly averageNameLength: number;
  /** Mean description-field length across the corpus, floored at 1. */
  readonly averageDescriptionLength: number;
  /** How many skills contain `term` anywhere in their routing surface. */
  documentFrequency(term: string): number;
  /** BM25 probabilistic inverse document frequency for `term`. */
  idf(term: string): number;
  /** Most representative surface form of `term`, for display. */
  surfaceOf(term: string): string;
  /** Every term in the corpus, ascending by document frequency then alphabetically. */
  vocabulary(): readonly string[];
}

function indexField(text: string, options: TokenizeOptions): { index: FieldIndex; tokens: Token[] } {
  const tokens = tokenize(text, options);
  return {
    index: { frequencies: termFrequencies(tokens), length: tokens.length },
    tokens,
  };
}

/**
 * BM25 probabilistic IDF, in the variant that cannot go negative:
 *
 *     idf(t) = ln(1 + (N - df + 0.5) / (df + 0.5))
 *
 * The classic Robertson–Sparck Jones formula turns negative once a term appears
 * in more than half the corpus, which would make a shared word actively
 * *subtract* from a skill's score — nonsense here, where a term appearing in
 * every skill should be worthless, not harmful.
 *
 * The behaviour this produces is exactly the reported failure mode. In a
 * collection where 84 of 100 skills mention "security", that term scores 0.19
 * while a term unique to one skill scores 5.3 — a 28x difference. The formula
 * is what turns "everyone uses the same words" into a measurable number.
 */
function computeIdf(documentFrequency: number, corpusSize: number): number {
  return Math.log(1 + (corpusSize - documentFrequency + 0.5) / (documentFrequency + 0.5));
}

/** Build a searchable index over the routing surface of every skill. */
export function buildCorpus(skills: readonly Skill[], options: TokenizeOptions = {}): Corpus {
  const documents: IndexedSkill[] = [];
  const documentFrequencies = new Map<string, number>();
  const allTokens: Token[] = [];

  let totalNameLength = 0;
  let totalDescriptionLength = 0;

  for (const skill of skills) {
    // Hyphens and underscores in names are token separators, so `pdf-extract`
    // indexes as two terms without any special-casing.
    const name = indexField(skill.name, options);
    const description = indexField(skill.description, options);

    const terms = new Set<string>([...name.index.frequencies.keys(), ...description.index.frequencies.keys()]);
    for (const term of terms) {
      documentFrequencies.set(term, (documentFrequencies.get(term) ?? 0) + 1);
    }

    const tokens = [...name.tokens, ...description.tokens];
    allTokens.push(...tokens);

    totalNameLength += name.index.length;
    totalDescriptionLength += description.index.length;

    documents.push({ skill, name: name.index, description: description.index, terms, tokens });
  }

  const size = documents.length;
  const surfaces = surfaceForms(allTokens);
  const idfCache = new Map<string, number>();

  const averageNameLength = size === 0 ? 1 : Math.max(1, totalNameLength / size);
  const averageDescriptionLength = size === 0 ? 1 : Math.max(1, totalDescriptionLength / size);

  return {
    documents,
    size,
    averageNameLength,
    averageDescriptionLength,

    documentFrequency(term: string): number {
      return documentFrequencies.get(term) ?? 0;
    },

    idf(term: string): number {
      const cached = idfCache.get(term);
      if (cached !== undefined) return cached;

      // An unseen query term gets the score of a hypothetical unique term
      // rather than zero, so out-of-vocabulary words neither help nor silently
      // vanish from explanations.
      const df = documentFrequencies.get(term) ?? 0;
      const value = computeIdf(df, size);
      idfCache.set(term, value);
      return value;
    },

    surfaceOf(term: string): string {
      return surfaces.get(term) ?? term;
    },

    vocabulary(): readonly string[] {
      return [...documentFrequencies.entries()]
        .sort((a, b) => (a[1] - b[1]) || a[0].localeCompare(b[0]))
        .map(([term]) => term);
    },
  };
}
