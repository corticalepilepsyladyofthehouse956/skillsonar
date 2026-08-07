import { DEFAULT_STOPWORDS } from './stopwords.ts';
import { stem } from './stemmer.ts';

/** A single analysable unit of text, kept alongside enough context to explain it. */
export interface Token {
  /** The normalised but unstemmed word, as it will be shown back to the user. */
  readonly surface: string;
  /** The stemmed form. This is the key everything is indexed and scored by. */
  readonly term: string;
  /** Character offset of the token in the original string, for diagnostics. */
  readonly offset: number;
}

export interface TokenizeOptions {
  /** Terms to drop before scoring. Defaults to {@link DEFAULT_STOPWORDS}. */
  readonly stopwords?: ReadonlySet<string>;
  /** Skip Porter stemming and index surface forms. Defaults to `false`. */
  readonly noStemming?: boolean;
  /** Shortest surface form to keep. Defaults to `2`. */
  readonly minLength?: number;
}

/**
 * Matches runs of letters and digits, allowing internal apostrophes so that
 * "don't" survives as one token instead of splitting into "don" and "t".
 */
const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;

/**
 * Case boundaries inside a single word. Two cases, matching how developers
 * actually name things:
 *   - lower-or-digit followed by upper: `parseJson` -> `parse` + `Json`
 *   - upper followed by upper-then-lower: `HTTPServer` -> `HTTP` + `Server`
 */
const CASE_BOUNDARY = /(?<=[\p{Ll}\p{N}])(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/gu;

/**
 * Strip diacritics so that "café" and "cafe" index identically.
 *
 * NFD decomposes an accented character into base + combining mark, and the
 * range U+0300..U+036F is exactly the combining diacritical marks block, so
 * removing it leaves the base letters intact. Scripts that do not decompose
 * this way — CJK, Arabic, Hebrew — pass through untouched, which is correct:
 * their characters carry meaning that must not be discarded.
 */
function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/gu, '');
}

/**
 * Split a raw word into sub-words on case boundaries.
 *
 * Snake case, kebab case and dotted paths are already handled by
 * {@link WORD_PATTERN}, which never matches across `_`, `-` or `.`. This
 * function only has to deal with the boundaries that live inside a single
 * run of letters.
 */
function splitIdentifier(word: string): string[] {
  const parts = word.split(CASE_BOUNDARY);
  return parts.length > 1 ? parts : [word];
}

/**
 * Convert free text into scoreable tokens.
 *
 * The pipeline is: extract words, split identifiers on case boundaries,
 * lowercase, strip diacritics, drop stop words and short tokens, then stem.
 *
 * Stop words are checked *before* stemming against the raw lowercase form,
 * because the stop lists are written in surface English. Checking after
 * stemming would let "using" through as `us` while "use" was correctly dropped.
 */
export function tokenize(text: string, options: TokenizeOptions = {}): Token[] {
  const stopwords = options.stopwords ?? DEFAULT_STOPWORDS;
  const minLength = options.minLength ?? 2;
  const tokens: Token[] = [];

  for (const match of text.matchAll(WORD_PATTERN)) {
    const raw = match[0];
    const base = match.index;

    let cursor = 0;
    for (const part of splitIdentifier(raw)) {
      const offset = base + cursor;
      cursor += part.length;

      const surface = stripDiacritics(part.toLowerCase());
      if (surface.length < minLength) continue;
      if (stopwords.has(surface)) continue;

      const term = options.noStemming === true ? surface : stem(surface);
      if (term.length === 0) continue;

      tokens.push({ surface, term, offset });
    }
  }

  return tokens;
}

/** Tokenize and return only the distinct stemmed terms, in first-seen order. */
export function uniqueTerms(text: string, options: TokenizeOptions = {}): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const token of tokenize(text, options)) {
    if (seen.has(token.term)) continue;
    seen.add(token.term);
    terms.push(token.term);
  }

  return terms;
}

/** Count occurrences of each stemmed term. */
export function termFrequencies(tokens: readonly Token[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token.term, (counts.get(token.term) ?? 0) + 1);
  }
  return counts;
}

/**
 * Map each stemmed term back to the surface form seen most often.
 *
 * Scores are computed on stems, but a report that says `migrat` scored 4.2 is
 * useless. This lets the reporter say `migrations` instead.
 */
export function surfaceForms(tokens: readonly Token[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();

  for (const token of tokens) {
    let byS = counts.get(token.term);
    if (byS === undefined) {
      byS = new Map<string, number>();
      counts.set(token.term, byS);
    }
    byS.set(token.surface, (byS.get(token.surface) ?? 0) + 1);
  }

  const best = new Map<string, string>();
  for (const [term, forms] of counts) {
    // Sorted rather than scanned so the choice does not depend on the order
    // documents happened to be read in. Most frequent wins; ties go to the
    // shorter form ("review" over "reviewing"), then alphabetically, which
    // makes the displayed vocabulary identical on every machine.
    const winner = [...forms.entries()].sort(
      (a, b) => (b[1] - a[1]) || (a[0].length - b[0].length) || a[0].localeCompare(b[0]),
    )[0];
    best.set(term, winner?.[0] ?? term);
  }

  return best;
}
