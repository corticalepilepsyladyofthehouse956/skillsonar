import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, parseYaml } from '../src/skills/frontmatter.ts';

test('parses the common skill frontmatter shape', () => {
  const result = parseFrontmatter([
    '---',
    'name: pdf-extract',
    'description: Use when the user needs data out of a PDF.',
    'license: MIT',
    '---',
    '',
    '# Body',
  ].join('\n'));

  assert.equal(result.present, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.data['name'], 'pdf-extract');
  assert.equal(result.data['description'], 'Use when the user needs data out of a PDF.');
  assert.equal(result.data['license'], 'MIT');
  assert.match(result.body, /# Body/);
});

test('folds a ">" block scalar into a single line', () => {
  const result = parseFrontmatter([
    '---',
    'name: demo',
    'description: >',
    '  Use this skill when the user is doing',
    '  something specific and identifiable.',
    '---',
  ].join('\n'));

  assert.equal(
    result.data['description'],
    'Use this skill when the user is doing something specific and identifiable.\n',
  );
});

test('preserves newlines in a "|" block scalar and honours the strip indicator', () => {
  const result = parseFrontmatter([
    '---',
    'text: |-',
    '  first',
    '  second',
    '---',
  ].join('\n'));

  assert.equal(result.data['text'], 'first\nsecond');
});

test('joins a multi-line plain scalar with spaces', () => {
  // The single most common real-world shape: a description that wraps without
  // any block indicator. Mis-parsing this truncates the routing surface.
  const result = parseFrontmatter([
    '---',
    'description: Use this when the user has a CSV file',
    '  and wants summary statistics from it.',
    'name: csv-stats',
    '---',
  ].join('\n'));

  assert.equal(
    result.data['description'],
    'Use this when the user has a CSV file and wants summary statistics from it.',
  );
  assert.equal(result.data['name'], 'csv-stats');
});

test('reads flow and block sequences', () => {
  const flow = parseFrontmatter('---\nallowed-tools: [Read, Grep, Bash]\n---');
  assert.deepEqual(flow.data['allowed-tools'], ['Read', 'Grep', 'Bash']);

  const block = parseFrontmatter('---\ntags:\n  - security\n  - review\n---');
  assert.deepEqual(block.data['tags'], ['security', 'review']);
});

test('reads nested mappings', () => {
  const result = parseFrontmatter([
    '---',
    'metadata:',
    '  version: 1.2',
    '  author: someone',
    '---',
  ].join('\n'));

  assert.deepEqual(result.data['metadata'], { version: 1.2, author: 'someone' });
});

test('keeps a "#" that is part of a value', () => {
  // A URL fragment or a CSS colour must survive; only whitespace-preceded
  // hashes start comments.
  const result = parseFrontmatter('---\nhomepage: https://example.dev/docs#install  # trailing\n---');
  assert.equal(result.data['homepage'], 'https://example.dev/docs#install');
});

test('keeps a colon inside a value', () => {
  const result = parseFrontmatter('---\nhomepage: https://example.dev\n---');
  assert.equal(result.data['homepage'], 'https://example.dev');
});

test('decodes quoted scalars', () => {
  const result = parseFrontmatter([
    '---',
    'a: "line\\nbreak"',
    "b: 'it''s quoted'",
    'c: "2024"',
    '---',
  ].join('\n'));

  assert.equal(result.data['a'], 'line\nbreak');
  assert.equal(result.data['b'], "it's quoted");
  // Quoting must defeat numeric coercion, or a version string becomes a float.
  assert.equal(result.data['c'], '2024');
});

test('applies core-schema type coercion to plain scalars', () => {
  const result = parseFrontmatter([
    '---',
    'count: 42',
    'ratio: 0.5',
    'enabled: true',
    'missing: null',
    '---',
  ].join('\n'));

  assert.equal(result.data['count'], 42);
  assert.equal(result.data['ratio'], 0.5);
  assert.equal(result.data['enabled'], true);
  assert.equal(result.data['missing'], null);
});

test('reports an unterminated frontmatter block', () => {
  const result = parseFrontmatter('---\nname: broken\n\n# no closing delimiter');
  assert.equal(result.present, true);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0]?.message ?? '', /never closed/);
});

test('reports a duplicate key with its line number', () => {
  const result = parseFrontmatter('---\nname: a\nname: b\n---');
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0]?.message ?? '', /duplicate key "name"/);
  assert.equal(result.errors[0]?.line, 3);
});

test('refuses unsupported YAML rather than mis-parsing it', () => {
  // Silently accepting an anchor would produce a confident, wrong analysis.
  const result = parseFrontmatter('---\n&anchor\nname: a\n---');
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0]?.message ?? '', /anchors are not supported/);
});

test('reports a line that is not a mapping entry', () => {
  const result = parseFrontmatter('---\nname: a\njust some text\n---');
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0]?.message ?? '', /expected "key: value"/);
});

test('tolerates a byte-order mark and CRLF line endings', () => {
  const result = parseFrontmatter('﻿---\r\nname: windows-authored\r\n---\r\n\r\nbody');
  assert.equal(result.present, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.data['name'], 'windows-authored');
});

test('returns no frontmatter for a plain Markdown file', () => {
  const result = parseFrontmatter('# Just a heading\n\nSome text.');
  assert.equal(result.present, false);
  assert.deepEqual(result.data, {});
  assert.match(result.body, /Just a heading/);
});

test('reports the body line so diagnostics point at the right place', () => {
  const result = parseFrontmatter('---\nname: a\ndescription: b\n---\nbody starts here');
  assert.equal(result.bodyLine, 5);
});

test('parseYaml reads a standalone document', () => {
  const result = parseYaml('tests:\n  - query: hello\n    expect: greeter\n');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.data['tests'], [{ query: 'hello', expect: 'greeter' }]);
});

test('parseYaml reads sequence entries with multiple keys and block scalars', () => {
  const result = parseYaml([
    'tests:',
    '  - query: first',
    '    expect: alpha',
    '    minMargin: 0.25',
    '    note: >',
    '      wrapped explanation',
    '      continuing here',
    '  - query: second',
    '    expect: none',
  ].join('\n'));

  assert.deepEqual(result.errors, []);
  const tests = result.data['tests'] as Record<string, unknown>[];
  assert.equal(tests.length, 2);
  assert.equal(tests[0]?.['expect'], 'alpha');
  assert.equal(tests[0]?.['minMargin'], 0.25);
  assert.equal(tests[0]?.['note'], 'wrapped explanation continuing here\n');
  assert.equal(tests[1]?.['expect'], 'none');
});
