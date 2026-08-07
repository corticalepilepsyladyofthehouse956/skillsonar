import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stem } from '../src/text/stemmer.ts';

/**
 * Vectors drawn from Porter's published sample data. They are the reference
 * every implementation is checked against, and they cover the rule
 * interactions — particularly steps 1b and 5 — that a hand-rolled stemmer
 * silently gets wrong.
 */
const PORTER_VECTORS: readonly (readonly [string, string])[] = [
  ['caresses', 'caress'], ['ponies', 'poni'], ['ties', 'ti'], ['caress', 'caress'], ['cats', 'cat'],
  ['feed', 'feed'], ['agreed', 'agre'], ['plastered', 'plaster'], ['bled', 'bled'],
  ['motoring', 'motor'], ['sing', 'sing'],
  ['conflated', 'conflat'], ['troubled', 'troubl'], ['sized', 'size'], ['hopping', 'hop'],
  ['tanned', 'tan'], ['falling', 'fall'], ['hissing', 'hiss'], ['fizzed', 'fizz'], ['failing', 'fail'],
  ['filing', 'file'],
  ['happy', 'happi'], ['sky', 'sky'],
  ['relational', 'relat'], ['conditional', 'condit'], ['rational', 'ration'],
  ['valenci', 'valenc'], ['hesitanci', 'hesit'], ['digitizer', 'digit'], ['conformabli', 'conform'],
  ['radicalli', 'radic'], ['differentli', 'differ'], ['vileli', 'vile'], ['analogousli', 'analog'],
  ['vietnamization', 'vietnam'], ['predication', 'predic'], ['operator', 'oper'],
  ['feudalism', 'feudal'], ['decisiveness', 'decis'], ['hopefulness', 'hope'],
  ['callousness', 'callous'], ['formaliti', 'formal'], ['sensitiviti', 'sensit'], ['sensibiliti', 'sensibl'],
  ['triplicate', 'triplic'], ['formative', 'form'], ['formalize', 'formal'], ['electriciti', 'electr'],
  ['electrical', 'electr'], ['hopeful', 'hope'], ['goodness', 'good'],
  ['revival', 'reviv'], ['allowance', 'allow'], ['inference', 'infer'], ['airliner', 'airlin'],
  ['gyroscopic', 'gyroscop'], ['adjustable', 'adjust'], ['defensible', 'defens'], ['irritant', 'irrit'],
  ['replacement', 'replac'], ['adjustment', 'adjust'], ['dependent', 'depend'], ['adoption', 'adopt'],
  ['homologou', 'homolog'], ['communism', 'commun'], ['activate', 'activ'], ['angulariti', 'angular'],
  ['homologous', 'homolog'], ['effective', 'effect'], ['bowdlerize', 'bowdler'],
  ['probate', 'probat'], ['rate', 'rate'], ['cease', 'ceas'],
  ['controll', 'control'], ['roll', 'roll'],
];

test('matches the reference Porter vectors', () => {
  for (const [input, expected] of PORTER_VECTORS) {
    assert.equal(stem(input), expected, `stem("${input}")`);
  }
});

test('conflates the morphological variants routing depends on', () => {
  // The point of stemming here is that a user's phrasing and an author's
  // description months earlier must land on the same term.
  const families: readonly (readonly string[])[] = [
    ['migrate', 'migrating', 'migration', 'migrations'],
    ['extract', 'extracts', 'extracting', 'extraction'],
    ['validate', 'validating', 'validation'],
    ['review', 'reviews', 'reviewing'],
  ];

  for (const family of families) {
    const stems = new Set(family.map(stem));
    assert.equal(stems.size, 1, `${family.join('/')} should share one stem, got ${[...stems].join(', ')}`);
  }
});

test('leaves short tokens and acronyms intact', () => {
  // Stemming "ci" or "ai" would destroy the exact terms most likely to be a
  // skill's distinguishing vocabulary.
  for (const acronym of ['ci', 'ai', 'db', 'ui', 'os']) {
    assert.equal(stem(acronym), acronym);
  }
});

test('is deterministic', () => {
  // Determinism is the property the tool actually relies on — the same corpus
  // must index identically on every machine and every run.
  //
  // Note that Porter is deliberately *not* idempotent: "agreed" stems to
  // "agre", which stems again to "agr". That is correct behaviour, not a
  // defect, and it never matters because raw words are only ever stemmed once.
  for (const [input] of PORTER_VECTORS) {
    assert.equal(stem(input), stem(input));
  }
});

test('handles empty and single-character input without throwing', () => {
  assert.equal(stem(''), '');
  assert.equal(stem('a'), 'a');
  assert.equal(stem('ab'), 'ab');
});
