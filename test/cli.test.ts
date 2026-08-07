import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../src/cli.ts';
import { parseArguments, ArgumentError } from '../src/cli/args.ts';
import { parseSuite, runSuite } from '../src/testing/suite.ts';
import { buildCorpus } from '../src/analysis/corpus.ts';
import { defaultConfig } from '../src/config.ts';
import { writeCollection, captureStream, makeSkill } from './helpers.ts';

const COMMANDS = ['scan', 'route', 'explain', 'collide', 'budget', 'test', 'rules', 'init'];

async function invoke(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  const out = captureStream();
  const err = captureStream();
  const code = await run(argv, { out, err });
  return { code, out: out.text(), err: err.text() };
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

test('suggests the intended flag when one is mistyped', () => {
  assert.throws(
    () => parseArguments(['--jsn'], COMMANDS),
    (error: unknown) => error instanceof ArgumentError && /Did you mean "--json"/.test(error.message),
  );
});

test('accepts both --flag value and --flag=value', () => {
  assert.equal(parseArguments(['--config', 'a.json'], COMMANDS).configPath, 'a.json');
  assert.equal(parseArguments(['--config=a.json'], COMMANDS).configPath, 'a.json');
});

test('rejects conflicting output formats', () => {
  assert.throws(
    () => parseArguments(['--json', '--sarif'], COMMANDS),
    (error: unknown) => error instanceof ArgumentError && /conflicting output formats/.test(error.message),
  );
});

test('rejects a flag value that is out of range', () => {
  assert.throws(
    () => parseArguments(['--limit', '0'], COMMANDS),
    (error: unknown) => error instanceof ArgumentError && /at least 1/.test(error.message),
  );
});

test('treats everything after -- as a positional', () => {
  const parsed = parseArguments(['route', '--', '--not-a-flag'], COMMANDS);
  assert.deepEqual(parsed.positionals, ['--not-a-flag']);
});

test('a query containing spaces stays one positional', () => {
  const parsed = parseArguments(['route', 'extract tables from a pdf'], COMMANDS);
  assert.deepEqual(parsed.positionals, ['extract tables from a pdf']);
});

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

test('--help and --version exit cleanly', async () => {
  const help = await invoke(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.out, /static routing analysis/);

  const version = await invoke(['--version']);
  assert.equal(version.code, 0);
  assert.match(version.out, /^\d+\.\d+\.\d+/);
});

test('an unknown command suggests the closest real one', async () => {
  const result = await invoke(['scna']);
  assert.equal(result.code, 2);
  assert.match(result.err, /Did you mean "scan"/);
});

test('scan exits 0 on a clean collection and 1 when errors are found', async () => {
  const clean = await writeCollection([
    { name: 'sql-migration', description: 'Use when writing a database schema migration for a live postgres system.' },
    { name: 'invoice-reconcile', description: 'Use when matching supplier invoices against purchase orders exactly.' },
  ]);

  try {
    const result = await invoke(['scan', clean.root]);
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /No issues found/);
  } finally {
    await clean.cleanup();
  }

  const broken = await writeCollection([{ name: 'no-meta', raw: '# no frontmatter\n' }]);
  try {
    const result = await invoke(['scan', broken.root]);
    assert.equal(result.code, 1);
    assert.match(result.out, /SR001/);
  } finally {
    await broken.cleanup();
  }
});

test('scan emits valid JSON with a stable schema version', async () => {
  const collection = await writeCollection([
    { name: 'alpha-thing', description: 'Use when the user needs the alpha capability applied to something.' },
  ]);

  try {
    const result = await invoke(['scan', collection.root, '--json']);
    const parsed = JSON.parse(result.out) as Record<string, unknown>;

    assert.equal(parsed['tool'], 'skillsonar');
    assert.equal(parsed['schemaVersion'], 1);
    assert.ok(Array.isArray(parsed['diagnostics']));
    assert.ok(typeof parsed['budget'] === 'object');
  } finally {
    await collection.cleanup();
  }
});

test('scan emits SARIF that carries every rule descriptor', async () => {
  const collection = await writeCollection([{ name: 'no-meta', raw: '# no frontmatter\n' }]);

  try {
    const result = await invoke(['scan', collection.root, '--sarif']);
    const parsed = JSON.parse(result.out) as {
      version: string;
      runs: { tool: { driver: { rules: { id: string }[] } }; results: { ruleId: string }[] }[];
    };

    assert.equal(parsed.version, '2.1.0');
    const driver = parsed.runs[0]?.tool.driver;
    assert.ok((driver?.rules.length ?? 0) >= 17, 'every rule must be described for code scanning');
    assert.ok(parsed.runs[0]?.results.some((entry) => entry.ruleId === 'SR001'));
  } finally {
    await collection.cleanup();
  }
});

test('route ranks skills and reports its verdict', async () => {
  const collection = await writeCollection([
    { name: 'sql-migration', description: 'Use when writing a database schema migration for a live postgres system.' },
    { name: 'invoice-reconcile', description: 'Use when matching supplier invoices against purchase orders exactly.' },
  ]);

  try {
    const result = await invoke(['route', 'write a postgres schema migration', collection.root, '--json']);
    const parsed = JSON.parse(result.out) as {
      verdict: string;
      ranked: { rank: number; skill: string }[];
    };

    assert.equal(parsed.ranked[0]?.skill, 'sql-migration');
    assert.equal(parsed.verdict, 'confident');
  } finally {
    await collection.cleanup();
  }
});

test('route without a query is a usage error', async () => {
  const result = await invoke(['route']);
  assert.equal(result.code, 2);
  assert.match(result.err, /requires a query/);
});

test('explain suggests a real skill name when given a near miss', async () => {
  const collection = await writeCollection([
    { name: 'sql-migration', description: 'Use when writing a database schema migration for a live postgres system.' },
  ]);

  try {
    const result = await invoke(['explain', 'sql-migrate', collection.root]);
    assert.equal(result.code, 2);
    assert.match(result.err, /Did you mean "sql-migration"/);
  } finally {
    await collection.cleanup();
  }
});

test('rules lists every rule with its default severity', async () => {
  const result = await invoke(['rules', '--json']);
  const parsed = JSON.parse(result.out) as { id: string; severity: string }[];

  assert.ok(parsed.length >= 17);
  assert.ok(parsed.every((rule) => ['error', 'warning', 'info'].includes(rule.severity)));
  assert.ok(parsed.some((rule) => rule.id === 'SR012'));
});

test('scanning a directory with no skills reports it plainly rather than failing', async () => {
  const collection = await writeCollection([]);
  try {
    const result = await invoke(['scan', collection.root]);
    assert.equal(result.code, 0);
    assert.match(result.out, /No SKILL\.md files found/);
  } finally {
    await collection.cleanup();
  }
});

test('an invalid config is a usage error naming the file and the problem', async () => {
  const collection = await writeCollection([]);
  const configPath = join(collection.root, 'bad.json');

  try {
    await writeFile(configPath, '{ "rules": { "SR999": "off" } }', 'utf8');
    const result = await invoke(['scan', collection.root, '--config', configPath]);

    assert.equal(result.code, 2);
    assert.match(result.err, /bad\.json/);
    assert.match(result.err, /unknown rule "SR999"/);
  } finally {
    await collection.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Routing test suites
// ---------------------------------------------------------------------------

const CORPUS = buildCorpus([
  makeSkill('sql-migration', 'Use when writing a database schema migration for a live postgres system.'),
  makeSkill('invoice-reconcile', 'Use when matching supplier invoices against purchase orders exactly.'),
]);

test('a suite passes when the expected skill wins', () => {
  const suite = parseSuite(
    'tests:\n  - query: write a postgres schema migration\n    expect: sql-migration\n',
    'inline.yaml',
  );

  assert.deepEqual(suite.errors, []);
  const run = runSuite(suite, CORPUS, defaultConfig());
  assert.equal(run.failed, 0);
});

test('a suite fails with the actual ranking when the wrong skill wins', () => {
  const suite = parseSuite(
    'tests:\n  - query: write a postgres schema migration\n    expect: invoice-reconcile\n',
    'inline.yaml',
  );

  const run = runSuite(suite, CORPUS, defaultConfig());
  assert.equal(run.failed, 1);
  assert.equal(run.outcomes[0]?.failure, 'wrong-skill');
  assert.match(run.outcomes[0]?.detail ?? '', /"sql-migration" won/);
});

test('a suite fails when the winning margin is below the requirement', () => {
  // Two skills that both match the query, so there is a real gap to measure.
  // With only one match the margin is 1 by definition — nothing competes.
  const contested = buildCorpus([
    makeSkill('schema-migration', 'Use when writing a database schema migration for a live system.'),
    makeSkill('schema-review', 'Use when reviewing a database schema change before it is applied live.'),
  ]);

  const suite = parseSuite(
    'tests:\n  - query: a database schema change for the live system\n'
    + '    expect: schema-migration\n    minMargin: 0.9\n',
    'inline.yaml',
  );

  const run = runSuite(suite, contested, defaultConfig());
  assert.equal(run.outcomes[0]?.failure, 'margin-too-low');
  assert.match(run.outcomes[0]?.detail ?? '', /closest rival/);
});

test('expect: none asserts that nothing matches', () => {
  const passing = runSuite(
    parseSuite('tests:\n  - query: what is the weather tomorrow\n    expect: none\n', 'inline.yaml'),
    CORPUS, defaultConfig(),
  );
  assert.equal(passing.failed, 0);

  const failing = runSuite(
    parseSuite('tests:\n  - query: write a postgres schema migration\n    expect: none\n', 'inline.yaml'),
    CORPUS, defaultConfig(),
  );
  assert.equal(failing.outcomes[0]?.failure, 'expected-none');
});

test('a suite referring to a deleted skill fails rather than passing silently', () => {
  // A test asserting behaviour about a skill that no longer exists must not go
  // green: that is how a suite rots into decoration.
  const run = runSuite(
    parseSuite('tests:\n  - query: anything at all\n    expect: skill-that-was-deleted\n', 'inline.yaml'),
    CORPUS, defaultConfig(),
  );

  assert.equal(run.outcomes[0]?.failure, 'unknown-skill');
  assert.match(run.outcomes[0]?.detail ?? '', /no skill named/);
});

test('a suite parses from JSON as well as YAML', () => {
  const suite = parseSuite(
    JSON.stringify({ tests: [{ query: 'write a postgres schema migration', expect: 'sql-migration' }] }),
    'inline.json',
  );

  assert.deepEqual(suite.errors, []);
  assert.equal(suite.cases.length, 1);
});

test('a malformed suite reports what is missing rather than throwing', () => {
  const missingExpect = parseSuite('tests:\n  - query: hello\n', 'inline.yaml');
  assert.match(missingExpect.errors[0]?.message ?? '', /missing "expect"/);

  const noTests = parseSuite('cases: []\n', 'inline.yaml');
  assert.match(noTests.errors[0]?.message ?? '', /missing top-level "tests" key/);

  const badMargin = parseSuite(
    'tests:\n  - query: hello\n    expect: sql-migration\n    minMargin: 5\n', 'inline.yaml',
  );
  assert.match(badMargin.errors[0]?.message ?? '', /between 0 and 1/);
});

test('the shipped example collection behaves exactly as its README claims', async () => {
  // The demo is documentation. If it drifts, the documentation is wrong.
  const result = await invoke(['scan', 'examples/collision-demo', '--json']);
  const parsed = JSON.parse(result.out) as {
    summary: { skills: number; collisions: number };
    collisions: { skills: string[]; severity: string }[];
  };

  assert.equal(parsed.summary.skills, 6);
  assert.ok(parsed.summary.collisions >= 1, 'the demo must still contain its deliberate collision');
  assert.ok(
    parsed.collisions.some((entry) =>
      entry.skills.includes('document-parser') && entry.skills.includes('pdf-extract')),
    'the documented colliding pair must still be reported',
  );
});
