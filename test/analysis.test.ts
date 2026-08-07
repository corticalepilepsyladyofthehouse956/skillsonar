import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCorpus } from '../src/analysis/corpus.ts';
import { route, signatureTerms, selfProbe } from '../src/analysis/router.ts';
import { findCollisions, findWeakSignals } from '../src/analysis/collisions.ts';
import { analyseBudget, estimateTokens } from '../src/analysis/budget.ts';
import { tokenize, uniqueTerms } from '../src/text/tokenize.ts';
import { makeSkill } from './helpers.ts';

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

test('splits identifiers on case, hyphen, underscore and dot boundaries', () => {
  const terms = tokenize('parseJSONFile snake_case kebab-case a.b.c')
    .map((token) => token.surface);

  assert.deepEqual(terms, ['parse', 'json', 'file', 'snake', 'case', 'kebab', 'case']);
});

test('drops stop words and skill boilerplate', () => {
  // "use this skill when the user wants" is pure boilerplate: it appears in
  // almost every description and would otherwise dominate short ones.
  const terms = uniqueTerms('Use this skill when the user wants to migrate a database');
  assert.deepEqual(terms, ['migrat', 'databas']);
});

test('folds diacritics but leaves non-Latin scripts alone', () => {
  assert.deepEqual(uniqueTerms('café'), uniqueTerms('cafe'));
  // Arabic carries meaning per character and must not be stripped.
  assert.equal(tokenize('تحليل').length, 1);
});

test('records offsets so diagnostics can point at a term', () => {
  const tokens = tokenize('alpha beta');
  assert.equal(tokens[0]?.offset, 0);
  assert.equal(tokens[1]?.offset, 6);
});

// ---------------------------------------------------------------------------
// Corpus and IDF
// ---------------------------------------------------------------------------

test('IDF collapses for a term shared across the collection', () => {
  const shared = Array.from({ length: 20 }, (_, i) =>
    makeSkill(`security-${i}`, 'Use when reviewing security concerns in the codebase.'));
  shared.push(makeSkill('invoice-reconcile', 'Use when matching invoices against purchase orders.'));

  const corpus = buildCorpus(shared);

  // This is the reported failure mode expressed as a number: a word 21 skills
  // share is worth a fraction of one that only a single skill claims.
  const common = corpus.idf('secur');
  const rare = corpus.idf('invoic');

  assert.ok(common > 0, 'IDF must never go negative, or shared terms would subtract');
  assert.ok(rare > common * 4, `expected a rare term to dominate, got ${rare} vs ${common}`);
});

test('indexes only the routing surface, never the body', () => {
  // Bodies do not influence selection, so indexing them would analyse a
  // decision the agent never makes.
  const corpus = buildCorpus([
    makeSkill('alpha', 'Use when handling widgets.', { body: 'kryptonite '.repeat(50) }),
  ]);

  assert.equal(corpus.documentFrequency('kryptonit'), 0);
  assert.equal(corpus.documentFrequency('widget'), 1);
});

test('name terms outweigh description terms', () => {
  const corpus = buildCorpus([
    makeSkill('kryptonite', 'Use this when the user needs help with something unrelated entirely.'),
    makeSkill('other-thing', 'Use this when the user mentions kryptonite in passing somewhere here.'),
  ]);

  const result = route(corpus, 'kryptonite');
  assert.equal(result.ranked[0]?.skill.name, 'kryptonite');
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test('reports an ambiguous verdict when two skills tie', () => {
  // The names must not contain query terms either. A name is part of the
  // routing surface and carries extra weight, so `doc-extract` would beat
  // `doc-parse` on a query containing "extract" even with identical
  // descriptions — which is correct behaviour, and would make this a test of
  // the wrong thing.
  const corpus = buildCorpus([
    makeSkill('alpha-tool', 'Use when the user needs structured data extracted from a document file.'),
    makeSkill('bravo-tool', 'Use when the user needs structured data extracted from a document file.'),
  ]);

  const result = route(corpus, 'extract structured data from a document');
  assert.equal(result.verdict, 'ambiguous');
  assert.ok(result.margin < 0.1, `expected a near-zero margin, got ${result.margin}`);
});

test('reports a confident verdict when one skill clearly owns the vocabulary', () => {
  const corpus = buildCorpus([
    makeSkill('sql-migration', 'Use when writing a database schema migration against a live system.'),
    makeSkill('invoice-reconcile', 'Use when matching supplier invoices against purchase orders.'),
  ]);

  const result = route(corpus, 'write a schema migration for the live database');
  assert.equal(result.ranked[0]?.skill.name, 'sql-migration');
  assert.equal(result.verdict, 'confident');
});

test('reports no-match when nothing meaningful overlaps', () => {
  const corpus = buildCorpus([
    makeSkill('sql-migration', 'Use when writing a database schema migration against a live system.'),
  ]);

  assert.equal(route(corpus, 'what is the weather tomorrow').verdict, 'no-match');
});

test('ranking is stable when scores tie', () => {
  // Without a deterministic tie-break, CI output would flip between runs and
  // the report would be undiffable.
  const skills = [
    makeSkill('bravo', 'Use when the user needs an identical capability here.'),
    makeSkill('alpha', 'Use when the user needs an identical capability here.'),
  ];

  const forward = route(buildCorpus(skills), 'identical capability');
  const reversed = route(buildCorpus([...skills].reverse()), 'identical capability');

  assert.deepEqual(
    forward.ranked.map((entry) => entry.skill.name),
    reversed.ranked.map((entry) => entry.skill.name),
  );
});

test('explains every score by the terms that produced it', () => {
  const corpus = buildCorpus([
    makeSkill('pdf-extract', 'Use when the user needs tables extracted from a PDF invoice.'),
  ]);

  const contributions = route(corpus, 'extract tables from an invoice').ranked[0]?.contributions ?? [];
  const terms = contributions.map((entry) => entry.surface);

  assert.ok(terms.includes('tables'));
  assert.ok(terms.includes('invoice'));
  // Contributions must be ordered so the strongest signal reads first.
  for (let i = 1; i < contributions.length; i += 1) {
    assert.ok((contributions[i - 1]?.weight ?? 0) >= (contributions[i]?.weight ?? 0));
  }
});

// ---------------------------------------------------------------------------
// Signature and self-probe
// ---------------------------------------------------------------------------

test('signature terms favour rare vocabulary over shared vocabulary', () => {
  // Every skill here is named "document-<something>", so the shared name term
  // cannot decide the ranking and the description vocabulary has to.
  const corpus = buildCorpus([
    makeSkill('document-one', 'Use when the user needs kryptonite handling for a document.'),
    makeSkill('document-two', 'Use when the user needs a document processed somehow.'),
    makeSkill('document-three', 'Use when the user needs a document reviewed carefully.'),
  ]);

  const document = corpus.documents.find((entry) => entry.skill.name === 'document-one');
  assert.ok(document !== undefined);

  const signature = signatureTerms(document, corpus, 6);
  const rank = (surface: string): number => signature.findIndex((entry) => entry.surface === surface);

  // "document" is shared by all three and must rank below anything unique,
  // including the skill's own name terms — a name is part of the routing
  // surface and legitimately carries the strongest signal a skill has.
  assert.ok(rank('kryptonite') !== -1, 'the unique term must appear in the signature');
  assert.ok(
    rank('kryptonite') < rank('document'),
    'a term unique to one skill must outrank a term every skill shares',
  );
  assert.equal(signature[signature.length - 1]?.surface, 'document');
});

test('a skill wins its own signature query when it has distinct vocabulary', () => {
  const corpus = buildCorpus([
    makeSkill('sql-migration', 'Use when writing a database schema migration against a live system.'),
    makeSkill('invoice-reconcile', 'Use when matching supplier invoices against purchase orders.'),
  ]);

  for (const document of corpus.documents) {
    assert.equal(selfProbe(document, corpus).winsOwnProbe, true, document.skill.name);
  }
});

test('a shadowed skill loses its own signature query', () => {
  // `handler` owns no term at all that `document-handler` does not also claim —
  // its own name is a substring of the rival's name, and every description word
  // reappears there. There is no phrasing of its purpose that routes to it.
  //
  // This is a deliberately hard finding to trigger, and that is the point: a
  // skill's own name normally protects it, so when this rule does fire the
  // skill is genuinely unreachable rather than merely contested.
  const corpus = buildCorpus([
    makeSkill('document-handler',
      'Use when the user has a document that needs handling, processing or conversion.'),
    makeSkill('handler', 'Use when a document needs handling.'),
  ]);

  const narrow = corpus.documents.find((entry) => entry.skill.name === 'handler');
  assert.ok(narrow !== undefined);

  const probe = selfProbe(narrow, corpus);
  assert.equal(probe.winsOwnProbe, false);
  assert.equal(probe.stolenBy, 'document-handler');
});

test('coverage is scale-free: the same match verdict holds at any corpus size', () => {
  // The regression this guards: an absolute score floor declared a perfect
  // two-skill tie a "no match", because BM25 scores shrink with corpus size
  // while the floor did not.
  const pair = buildCorpus([
    makeSkill('alpha-tool', 'Use when the user needs structured data extracted from a document file.'),
    makeSkill('bravo-tool', 'Use when the user needs structured data extracted from a document file.'),
  ]);

  const many = buildCorpus([
    makeSkill('alpha-tool', 'Use when the user needs structured data extracted from a document file.'),
    makeSkill('bravo-tool', 'Use when the user needs structured data extracted from a document file.'),
    ...Array.from({ length: 40 }, (_, i) =>
      makeSkill(`unrelated-${'abcdefghijklmnopqrstuvwxyz'[i % 26]}${i}`,
        'Use when the user needs an entirely unrelated capability applied to something else.')),
  ]);

  const small = route(pair, 'extract structured data from a document');
  const large = route(many, 'extract structured data from a document');

  assert.notEqual(small.verdict, 'no-match', 'a perfect match must not read as no-match');
  assert.equal(small.verdict, 'ambiguous');
  assert.equal(large.verdict, 'ambiguous');
  assert.ok(large.ranked[0] !== undefined && small.ranked[0] !== undefined);
  assert.ok(
    large.ranked[0].score > small.ranked[0].score * 3,
    'raw scores must indeed differ by scale, which is why coverage is needed',
  );
});

// ---------------------------------------------------------------------------
// Collisions
// ---------------------------------------------------------------------------

test('detects a collision between near-duplicate descriptions', () => {
  const report = findCollisions(buildCorpus([
    makeSkill('doc-parse', 'Use when the user needs structured data extracted from a document.'),
    makeSkill('doc-extract', 'Use when the user needs structured data extracted from a document.'),
    makeSkill('sql-migration', 'Use when writing a database schema migration against a live system.'),
  ]));

  assert.equal(report.collisions.length, 1);
  const collision = report.collisions[0];
  assert.equal(collision?.severity, 'critical');
  assert.ok((collision?.similarity ?? 0) > 0.9);
});

test('does not report distinct skills as colliding', () => {
  const report = findCollisions(buildCorpus([
    makeSkill('sql-migration', 'Use when writing a database schema migration against a live system.'),
    makeSkill('invoice-reconcile', 'Use when matching supplier invoices against purchase orders.'),
    makeSkill('threat-model', 'Use when mapping the attack surface of a new architecture design.'),
  ]));

  assert.deepEqual(report.collisions, []);
  assert.deepEqual(report.stolen, []);
});

test('orients a collision so the shadowed skill is reported first', () => {
  // Cosine similarity would score this pair as only loosely related because
  // the broad skill has much more vocabulary. Contested mass reports the truth:
  // the narrow skill is almost entirely subsumed.
  const report = findCollisions(buildCorpus([
    makeSkill('doc-everything',
      'Use when the user needs a document parsed, converted, summarised, translated, '
      + 'redacted, signed, compressed, or split into pages.'),
    makeSkill('doc-parse', 'Use when the user needs a document parsed.'),
  ]));

  const collision = report.collisions[0];
  assert.ok(collision !== undefined, 'expected a collision to be reported');
  assert.equal(collision.a.skill.name, 'doc-parse', 'the shadowed skill must be reported as "a"');
  assert.ok(collision.similarity > collision.reverseSimilarity);
});

test('finds skills with no distinguishing vocabulary', () => {
  // Named with shared words rather than a numeric suffix: `review-10` would
  // index "10" as a term unique to that skill, giving it a real routing signal
  // and correctly excluding it from this finding.
  const suffixes = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot',
    'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima'];
  const skills = suffixes.map((suffix) =>
    makeSkill(`code-review-${suffix}`, 'Use when reviewing code for issues found during the review process.'));
  skills.push(makeSkill('sql-migration', 'Use when writing a database schema migration for postgres.'));

  const corpus = buildCorpus(skills);
  const names = findWeakSignals(corpus).map((entry) => entry.document.skill.name);

  // Each generic skill still owns its call-sign, so none is flagged here — the
  // rule reports skills with *no* rare term, and a call-sign is a rare term.
  assert.ok(!names.includes('sql-migration'), 'a skill with rare vocabulary must not be flagged');
  assert.ok(corpus.idf('review') < 0.2, 'a term shared by 12 of 13 skills must be near-worthless');
  assert.ok(corpus.idf('migrat') > 2, 'a term unique to one skill must carry real weight');

  // Strip the call-signs and the same descriptions become genuinely unselectable.
  const anonymous = buildCorpus(suffixes.map((suffix, i) =>
    makeSkill(`review-${suffix}`, 'Use when reviewing code for issues found during the review process.', {
      id: `review-${i}/SKILL.md`,
      name: 'code-review',
    })));
  assert.equal(findWeakSignals(anonymous).length, suffixes.length);
});

test('weak-signal detection is scale-free and silent on tiny collections', () => {
  // The regression this guards: an absolute IDF floor flagged every skill in a
  // three-skill collection, because a term unique to one of three scores 0.98.
  const distinct = buildCorpus([
    makeSkill('sql-migration', 'Use when writing a database schema migration against a live system.'),
    makeSkill('invoice-reconcile', 'Use when matching supplier invoices against purchase orders.'),
    makeSkill('threat-model', 'Use when mapping the attack surface of a new architecture design.'),
  ]);

  assert.deepEqual(findWeakSignals(distinct), [], 'perfectly distinct skills must never be flagged');
});

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

test('token estimates land within 25% of a known reference count', () => {
  // Reference: this sentence is 12 words / 63 characters, which real BPE
  // tokenizers render as roughly 13 tokens.
  const estimate = estimateTokens('The quick brown fox jumps over the lazy dog near a riverbank.');
  assert.ok(estimate >= 10 && estimate <= 17, `estimate out of range: ${estimate}`);
});

test('token estimates grow monotonically with text length', () => {
  let previous = 0;
  for (const length of [10, 50, 200, 1000]) {
    const estimate = estimateTokens('word '.repeat(length));
    assert.ok(estimate > previous, `estimate did not grow at length ${length}`);
    previous = estimate;
  }
});

test('separates resident cost from deferred cost', () => {
  // A long body must not inflate the number that is paid on every request.
  const report = analyseBudget([
    makeSkill('alpha', 'Use when the user needs something specific and identifiable done.', {
      body: 'x '.repeat(4000),
    }),
  ]);

  assert.ok(report.totalResidentTokens < 100);
  assert.ok(report.totalDeferredTokens > 1000);
});

test('reports resident cost as a share of the context window', () => {
  const report = analyseBudget(
    Array.from({ length: 40 }, (_, i) =>
      makeSkill(`skill-${i}`, 'Use when the user needs a reasonably detailed description of some length here.')),
    { contextWindow: 10_000 },
  );

  assert.ok(report.residentShare > 0);
  assert.equal(
    report.residentShare,
    report.totalResidentTokens / 10_000,
  );
});

test('handles an empty collection without dividing by zero', () => {
  const corpus = buildCorpus([]);
  assert.equal(corpus.size, 0);
  assert.equal(route(corpus, 'anything').verdict, 'no-match');
  assert.deepEqual(findCollisions(corpus).collisions, []);
  assert.equal(analyseBudget([]).totalResidentTokens, 0);
});
