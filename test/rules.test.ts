import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/analyze.ts';
import { defaultConfig, parseConfig, ConfigError } from '../src/config.ts';
import { writeCollection } from './helpers.ts';
import type { Diagnostic } from '../src/types.ts';

function rulesIn(diagnostics: readonly Diagnostic[]): Set<string> {
  return new Set(diagnostics.map((diagnostic) => diagnostic.rule));
}

function findRule(diagnostics: readonly Diagnostic[], rule: string): Diagnostic | undefined {
  return diagnostics.find((diagnostic) => diagnostic.rule === rule);
}

test('SR001: reports a skill with no frontmatter', async () => {
  const collection = await writeCollection([{ name: 'broken', raw: '# Just a heading\n' }]);
  try {
    const result = await analyze([collection.root], defaultConfig());
    const finding = findRule(result.diagnostics, 'SR001');
    assert.ok(finding !== undefined, 'expected SR001');
    assert.equal(finding.severity, 'error');
    // Once frontmatter is missing every other field check is noise.
    assert.equal(result.diagnostics.filter((d) => d.file === finding.file).length, 1);
  } finally {
    await collection.cleanup();
  }
});

test('SR004 and SR005: reports an invalid name and a directory mismatch', async () => {
  const collection = await writeCollection([{
    name: 'my-skill',
    raw: [
      '---',
      'name: My_Skill',
      'description: Use this skill when the user needs something identifiable done here.',
      '---',
      '',
      '# Body',
    ].join('\n'),
  }]);

  try {
    const result = await analyze([collection.root], defaultConfig());
    const rules = rulesIn(result.diagnostics);
    assert.ok(rules.has('SR004'), 'expected SR004 for a non-hyphenated name');
    assert.ok(rules.has('SR005'), 'expected SR005 for a name/directory mismatch');
  } finally {
    await collection.cleanup();
  }
});

test('SR007: reports a description over the 1024-character limit', async () => {
  const collection = await writeCollection([{
    name: 'verbose',
    description: `Use this when the user ${'needs something done '.repeat(60)}`,
  }]);

  try {
    const result = await analyze([collection.root], defaultConfig());
    const finding = findRule(result.diagnostics, 'SR007');
    assert.ok(finding !== undefined, 'expected SR007');
    assert.match(finding.message, /exceeding the 1024-character limit/);
    // The hint must say exactly how much to cut, not just that it is too long.
    assert.match(finding.hint ?? '', /Remove \d+ characters/);
  } finally {
    await collection.cleanup();
  }
});

test('SR009: reports a capability blurb but accepts a trigger-framed description', async () => {
  const collection = await writeCollection([
    { name: 'blurb', description: 'Handles conversion of spreadsheets into other tabular formats.' },
    { name: 'framed', description: 'Use when the user needs a spreadsheet converted into another tabular format.' },
  ]);

  try {
    const result = await analyze([collection.root], defaultConfig());
    const findings = result.diagnostics.filter((diagnostic) => diagnostic.rule === 'SR009');
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.skill, 'blurb');
  } finally {
    await collection.cleanup();
  }
});

test('SR010: reports two skills sharing a name, on both files', async () => {
  const collection = await writeCollection([
    {
      name: 'first',
      raw: '---\nname: shared\ndescription: Use when the user needs the first identifiable thing done.\n---\n',
    },
    {
      name: 'second',
      raw: '---\nname: shared\ndescription: Use when the user needs the second identifiable thing done.\n---\n',
    },
  ]);

  try {
    const result = await analyze([collection.root], defaultConfig());
    const findings = result.diagnostics.filter((diagnostic) => diagnostic.rule === 'SR010');
    assert.equal(findings.length, 2, 'both files must be flagged, since either could shadow the other');
  } finally {
    await collection.cleanup();
  }
});

test('SR011: reports a collision between near-duplicate skills', async () => {
  const collection = await writeCollection([
    { name: 'doc-parse', description: 'Use when the user needs structured data extracted from a document.' },
    { name: 'doc-extract', description: 'Use when the user needs structured data extracted from a document.' },
  ]);

  try {
    const result = await analyze([collection.root], defaultConfig());
    const finding = findRule(result.diagnostics, 'SR011');
    assert.ok(finding !== undefined, 'expected SR011');
    // The hint has to name the words to change, or the finding is unactionable.
    assert.match(finding.hint ?? '', /Lead each description|no distinguishing vocabulary/);
  } finally {
    await collection.cleanup();
  }
});

test('SR015: reports a body reference to a file that does not exist', async () => {
  const collection = await writeCollection([{
    name: 'referencer',
    description: 'Use when the user needs a documented multi-step procedure carried out.',
    body: 'Follow [the checklist](references/checklist.md) and run `scripts/build.sh`.',
    files: { 'references/checklist.md': '# Checklist\n' },
  }]);

  try {
    const result = await analyze([collection.root], defaultConfig());
    const findings = result.diagnostics.filter((diagnostic) => diagnostic.rule === 'SR015');

    assert.equal(findings.length, 1, 'only the missing reference should be reported');
    assert.match(findings[0]?.message ?? '', /scripts\/build\.sh/);
  } finally {
    await collection.cleanup();
  }
});

test('SR015: ignores external links and anchors', async () => {
  const collection = await writeCollection([{
    name: 'linker',
    description: 'Use when the user needs a documented multi-step procedure carried out.',
    body: 'See [docs](https://example.dev/guide), [mail](mailto:a@b.dev) and [top](#heading).',
  }]);

  try {
    const result = await analyze([collection.root], defaultConfig());
    assert.equal(result.diagnostics.filter((d) => d.rule === 'SR015').length, 0);
  } finally {
    await collection.cleanup();
  }
});

test('SR017: reports an unrecognised frontmatter key', async () => {
  const collection = await writeCollection([{
    name: 'typo',
    raw: [
      '---',
      'name: typo',
      'descripton: Use when the user needs something identifiable done in this situation.',
      'description: Use when the user needs something identifiable done in this situation.',
      '---',
    ].join('\n'),
  }]);

  try {
    const result = await analyze([collection.root], defaultConfig());
    const finding = findRule(result.diagnostics, 'SR017');
    assert.ok(finding !== undefined, 'expected SR017');
    assert.match(finding.message, /descripton/);
  } finally {
    await collection.cleanup();
  }
});

test('a well-formed, well-separated collection reports nothing', async () => {
  // The most important test in the file: a linter that cannot be satisfied
  // gets switched off.
  const collection = await writeCollection([
    {
      name: 'sql-migration',
      description: 'Use when writing a database schema migration that must run against a live postgres system.',
    },
    {
      name: 'invoice-reconcile',
      description: 'Use when matching supplier invoices against purchase orders and explaining any discrepancy.',
    },
    {
      name: 'threat-model',
      description: 'Use when mapping the attack surface of a new architecture before any code is written.',
    },
  ]);

  try {
    const result = await analyze([collection.root], defaultConfig());
    assert.deepEqual(
      result.diagnostics.map((diagnostic) => `${diagnostic.rule} ${diagnostic.skill}: ${diagnostic.message}`),
      [],
    );
  } finally {
    await collection.cleanup();
  }
});

test('discovery finds skills under conventional roots and sorts them stably', async () => {
  const collection = await writeCollection([
    { name: 'zulu', description: 'Use when the user needs the last alphabetical capability applied.' },
    { name: 'alpha', description: 'Use when the user needs the first alphabetical capability applied.' },
  ]);

  try {
    const result = await analyze([collection.root], defaultConfig());
    assert.deepEqual(result.skills.map((skill) => skill.name), ['alpha', 'zulu']);
  } finally {
    await collection.cleanup();
  }
});

test('rule severity can be overridden and rules can be switched off', async () => {
  const collection = await writeCollection([
    { name: 'blurb', description: 'Handles conversion of spreadsheets into other tabular formats.' },
  ]);

  try {
    const promoted = await analyze([collection.root], {
      ...defaultConfig(),
      rules: { ...defaultConfig().rules, SR009: 'error' },
    });
    assert.equal(findRule(promoted.diagnostics, 'SR009')?.severity, 'error');

    const disabled = await analyze([collection.root], {
      ...defaultConfig(),
      rules: { ...defaultConfig().rules, SR009: 'off' },
    });
    assert.equal(findRule(disabled.diagnostics, 'SR009'), undefined);
  } finally {
    await collection.cleanup();
  }
});

test('analysis output is byte-identical across runs', async () => {
  // Determinism is the property that makes the report safe to commit and diff.
  const collection = await writeCollection([
    { name: 'doc-parse', description: 'Use when the user needs structured data extracted from a document.' },
    { name: 'doc-extract', description: 'Use when the user needs structured data extracted from a document.' },
    { name: 'sql-migration', description: 'Use when writing a database schema migration against a live system.' },
  ]);

  try {
    const first = await analyze([collection.root], defaultConfig());
    const second = await analyze([collection.root], defaultConfig());

    assert.deepEqual(
      first.diagnostics.map((d) => [d.rule, d.skill, d.message]),
      second.diagnostics.map((d) => [d.rule, d.skill, d.message]),
    );
  } finally {
    await collection.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

test('config rejects an unknown rule id with a usable message', () => {
  assert.throws(
    () => parseConfig({ rules: { SR999: 'off' } }, 'test.json'),
    (error: unknown) => error instanceof ConfigError && /unknown rule "SR999"/.test(error.message),
  );
});

test('config suggests the rule id when a rule title is used instead', () => {
  assert.throws(
    () => parseConfig({ rules: { 'routing-collision': 'off' } }, 'test.json'),
    (error: unknown) => error instanceof ConfigError && /Did you mean "SR011"/.test(error.message),
  );
});

test('config rejects an out-of-range scoring parameter', () => {
  assert.throws(
    () => parseConfig({ scoring: { descriptionLengthNormalisation: 40 } }, 'test.json'),
    (error: unknown) => error instanceof ConfigError && /must be between 0 and 1/.test(error.message),
  );
});

test('config rejects contradictory margin thresholds', () => {
  assert.throws(
    () => parseConfig({ thresholds: { ambiguousMargin: 0.9, contestedMargin: 0.1 } }, 'test.json'),
    (error: unknown) => error instanceof ConfigError && /stricter condition/.test(error.message),
  );
});

test('config explains the removal of the old minimumScore option', () => {
  assert.throws(
    () => parseConfig({ thresholds: { minimumScore: 0.35 } }, 'test.json'),
    (error: unknown) => error instanceof ConfigError && /replaced by thresholds\.minimumCoverage/.test(error.message),
  );
});

test('config rejects an unknown top-level option', () => {
  assert.throws(
    () => parseConfig({ collisons: {} }, 'test.json'),
    (error: unknown) => error instanceof ConfigError && /unknown option "collisons"/.test(error.message),
  );
});

test('config accepts "//" comment keys', () => {
  // JSON has no comments, so this convention is how a config explains itself.
  const parsed = parseConfig({
    '//': 'why SR009 is off for this repository',
    rules: { '// SR009': 'house style differs', SR009: 'off' },
  }, 'test.json');

  assert.equal(parsed.rules['SR009'], 'off');
});

test('an empty config is valid and yields the defaults', () => {
  const parsed = parseConfig({}, 'test.json');
  assert.equal(parsed.rules['SR011'], 'warning');
  assert.equal(parsed.thresholds.minimumCoverage, 0.15);
  assert.equal(parsed.followSymlinks, false);
});
