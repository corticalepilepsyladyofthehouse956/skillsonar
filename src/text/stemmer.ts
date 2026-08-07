/**
 * Porter stemming algorithm (Porter, 1980).
 *
 * Why a stemmer at all: routing analysis compares a user's phrasing against a
 * skill description written months earlier. "migrating a database" and
 * "database migration" must collide, or the analysis reports a clean routing
 * table that falls apart in production. Conflating morphological variants is
 * what makes that comparison meaningful.
 *
 * Why Porter specifically, rather than a heavier stemmer or a lemmatiser:
 * it is fully deterministic, needs no dictionary, runs in microseconds, and is
 * stable across runs and machines. Those properties are the whole premise of
 * this tool — an analysis you can put in CI and diff between commits.
 *
 * This is the original 1980 algorithm, not the later Porter2/Snowball revision,
 * because Porter's published test vectors are the most widely available
 * reference to verify an implementation against.
 */

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

/** True when `word[i]` is a vowel. `y` is a vowel unless preceded by a vowel. */
function isVowel(word: string, i: number): boolean {
  const ch = word[i];
  if (ch === undefined) return false;
  if (VOWELS.has(ch)) return true;
  if (ch !== 'y') return false;
  return i === 0 ? false : !isVowel(word, i - 1);
}

function isConsonant(word: string, i: number): boolean {
  return !isVowel(word, i);
}

/**
 * Porter's measure `m`: the number of vowel-consonant sequences in the stem.
 * Written as `[C](VC){m}[V]`, `m` counts the `(VC)` repetitions.
 */
function measure(stem: string): number {
  let m = 0;
  let i = 0;
  const n = stem.length;

  while (i < n && isConsonant(stem, i)) i += 1;

  while (i < n) {
    while (i < n && isVowel(stem, i)) i += 1;
    if (i >= n) break;
    while (i < n && isConsonant(stem, i)) i += 1;
    m += 1;
  }

  return m;
}

/** Porter's `*v*`: the stem contains a vowel. */
function containsVowel(stem: string): boolean {
  for (let i = 0; i < stem.length; i += 1) {
    if (isVowel(stem, i)) return true;
  }
  return false;
}

/** Porter's `*d`: the stem ends with a double consonant. */
function endsWithDoubleConsonant(stem: string): boolean {
  const n = stem.length;
  if (n < 2) return false;
  if (stem[n - 1] !== stem[n - 2]) return false;
  return isConsonant(stem, n - 1);
}

/**
 * Porter's `*o`: the stem ends `consonant-vowel-consonant`, where the final
 * consonant is not `w`, `x`, or `y`.
 */
function endsCvc(stem: string): boolean {
  const n = stem.length;
  if (n < 3) return false;
  if (!isConsonant(stem, n - 1)) return false;
  if (!isVowel(stem, n - 2)) return false;
  if (!isConsonant(stem, n - 3)) return false;
  const last = stem[n - 1];
  return last !== 'w' && last !== 'x' && last !== 'y';
}

/** Replace `suffix` with `replacement` when the resulting stem satisfies `test`. */
function replaceSuffix(
  word: string,
  suffix: string,
  replacement: string,
  test?: (stem: string) => boolean,
): string | null {
  if (!word.endsWith(suffix)) return null;
  const stem = word.slice(0, word.length - suffix.length);
  if (test && !test(stem)) return null;
  return stem + replacement;
}

/** Apply the first matching rule from an ordered list; return `word` if none match. */
function applyFirst(
  word: string,
  rules: readonly (readonly [string, string, ((stem: string) => boolean)?])[],
): string {
  for (const [suffix, replacement, test] of rules) {
    const result = replaceSuffix(word, suffix, replacement, test);
    if (result !== null) return result;
  }
  return word;
}

const positiveMeasure = (stem: string): boolean => measure(stem) > 0;
const measureOverOne = (stem: string): boolean => measure(stem) > 1;

const STEP2_RULES = [
  ['ational', 'ate'], ['tional', 'tion'], ['enci', 'ence'], ['anci', 'ance'],
  ['izer', 'ize'], ['abli', 'able'], ['alli', 'al'], ['entli', 'ent'],
  ['eli', 'e'], ['ousli', 'ous'], ['ization', 'ize'], ['ation', 'ate'],
  ['ator', 'ate'], ['alism', 'al'], ['iveness', 'ive'], ['fulness', 'ful'],
  ['ousness', 'ous'], ['aliti', 'al'], ['iviti', 'ive'], ['biliti', 'ble'],
] as const;

const STEP3_RULES = [
  ['icate', 'ic'], ['ative', ''], ['alize', 'al'], ['iciti', 'ic'],
  ['ical', 'ic'], ['ful', ''], ['ness', ''],
] as const;

const STEP4_SUFFIXES = [
  'al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant', 'ement', 'ment',
  'ent', 'ou', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize',
] as const;

/** Steps 1b(ii) and 3 of the algorithm share this cleanup pass. */
function fixShortStem(stem: string): string {
  const patched = applyFirst(stem, [['at', 'ate'], ['bl', 'ble'], ['iz', 'ize']]);
  if (patched !== stem) return patched;

  if (endsWithDoubleConsonant(stem)) {
    const last = stem[stem.length - 1];
    if (last !== 'l' && last !== 's' && last !== 'z') {
      return stem.slice(0, -1);
    }
    return stem;
  }

  if (measure(stem) === 1 && endsCvc(stem)) return `${stem}e`;
  return stem;
}

function step1a(word: string): string {
  return applyFirst(word, [['sses', 'ss'], ['ies', 'i'], ['ss', 'ss'], ['s', '']]);
}

function step1b(word: string): string {
  const eed = replaceSuffix(word, 'eed', 'ee', positiveMeasure);
  if (eed !== null) return eed;
  if (word.endsWith('eed')) return word;

  for (const suffix of ['ed', 'ing'] as const) {
    const stripped = replaceSuffix(word, suffix, '', containsVowel);
    if (stripped !== null) return fixShortStem(stripped);
  }

  return word;
}

function step1c(word: string): string {
  return replaceSuffix(word, 'y', 'i', containsVowel) ?? word;
}

function step2(word: string): string {
  return applyFirst(word, STEP2_RULES.map(([s, r]) => [s, r, positiveMeasure] as const));
}

function step3(word: string): string {
  return applyFirst(word, STEP3_RULES.map(([s, r]) => [s, r, positiveMeasure] as const));
}

function step4(word: string): string {
  for (const suffix of STEP4_SUFFIXES) {
    const stripped = replaceSuffix(word, suffix, '', measureOverOne);
    if (stripped !== null) return stripped;
  }

  // `ion` is only removed after `s` or `t`, otherwise "lion" would become "li".
  const ion = replaceSuffix(word, 'ion', '', (stem) => {
    if (measure(stem) <= 1) return false;
    const last = stem[stem.length - 1];
    return last === 's' || last === 't';
  });

  return ion ?? word;
}

function step5(word: string): string {
  let result = word;

  if (result.endsWith('e')) {
    const stem = result.slice(0, -1);
    const m = measure(stem);
    if (m > 1 || (m === 1 && !endsCvc(stem))) result = stem;
  }

  if (measure(result) > 1 && result.endsWith('ll')) {
    result = result.slice(0, -1);
  }

  return result;
}

/**
 * Reduce an already-lowercased ASCII word to its Porter stem.
 *
 * Words of two characters or fewer are returned unchanged: the algorithm's
 * rules assume a stem long enough to have a measure, and short tokens are
 * almost always acronyms ("ci", "ai", "db") where stemming would destroy meaning.
 */
export function stem(word: string): string {
  if (word.length <= 2) return word;

  let result = step1a(word);
  result = step1b(result);
  result = step1c(result);
  result = step2(result);
  result = step3(result);
  result = step4(result);
  result = step5(result);

  return result;
}
