import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseYaml, type YamlMap, type YamlValue } from '../skills/frontmatter.ts';
import { route } from '../analysis/router.ts';
import type { Corpus } from '../analysis/corpus.ts';
import type { SkillsonarConfig } from '../config.ts';
import type { RoutingResult } from '../types.ts';

/**
 * Routing regression tests.
 *
 * This is the part of the tool meant to live in a repository permanently. The
 * problem it solves is specific and well documented: editing one skill's
 * description silently changes which skill wins for queries that have nothing
 * to do with the edit. Nobody notices until a user reports that a completely
 * different feature stopped working.
 *
 * The established remedy is to run the real agent over a labelled query set
 * several times each and measure trigger rates. That is the right way to
 * measure model behaviour, and it costs API calls, wall-clock minutes, and a
 * tolerance for nondeterminism that makes it unpleasant to gate a pull request
 * on.
 *
 * These tests answer a narrower question deterministically and in milliseconds:
 * given the descriptions as written, does the intended skill still hold the top
 * of the lexical ranking, and by how much? That catches the regression class
 * that matters — "my edit moved a boundary I wasn't looking at" — without
 * pretending to predict a model. Use both: this in CI on every commit, trigger
 * evals before a release.
 */

/** The sentinel `expect` value asserting that nothing should match. */
export const EXPECT_NONE = 'none';

export interface RoutingTestCase {
  readonly query: string;
  /** Skill name that must rank first, or `"none"` for no meaningful match. */
  readonly expect: string;
  /** Require at least this relative gap over second place, in `[0, 1]`. */
  readonly minMargin?: number;
  /** Skill names that must not rank first. */
  readonly avoid?: readonly string[];
  /** Free-text note echoed on failure, for explaining intent. */
  readonly note?: string;
  /** 1-based line in the suite file, for error reporting. */
  readonly line: number;
}

export interface SuiteParseError {
  readonly line: number;
  readonly message: string;
}

export interface RoutingTestSuite {
  readonly cases: readonly RoutingTestCase[];
  readonly path: string;
  readonly errors: readonly SuiteParseError[];
}

function asString(value: YamlValue): string | null {
  return typeof value === 'string' ? value : null;
}

function asStringArray(value: YamlValue): string[] | null {
  if (!Array.isArray(value)) return null;
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return null;
    result.push(entry);
  }
  return result;
}

/**
 * Parse a suite from YAML or JSON text.
 *
 * Both formats are accepted because the two audiences differ: humans author
 * suites in YAML, and tooling that generates suites from production traffic
 * emits JSON. Detection is by first non-whitespace character rather than file
 * extension, so a `.yaml` file containing JSON still works.
 */
export function parseSuite(source: string, path: string): RoutingTestSuite {
  const errors: SuiteParseError[] = [];
  let document: YamlMap;

  const trimmed = source.trimStart();
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(source);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { cases: [], path, errors: [{ line: 1, message: 'expected a JSON object with a "tests" array' }] };
      }
      document = parsed as YamlMap;
    } catch (error) {
      return {
        cases: [],
        path,
        errors: [{ line: 1, message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  } else {
    const parsed = parseYaml(source);
    document = parsed.data;
    errors.push(...parsed.errors);
  }

  const rawTests = document['tests'];
  if (rawTests === undefined) {
    errors.push({ line: 1, message: 'missing top-level "tests" key' });
    return { cases: [], path, errors };
  }
  if (!Array.isArray(rawTests)) {
    errors.push({ line: 1, message: '"tests" must be a list of test cases' });
    return { cases: [], path, errors };
  }

  const cases: RoutingTestCase[] = [];

  rawTests.forEach((entry, index) => {
    // Line numbers are approximate for list entries: the subset parser does not
    // track per-item positions. The 1-based index is included in the message so
    // a failing case is still findable in a long file.
    const line = index + 1;

    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      errors.push({ line, message: `test #${line} must be a mapping with "query" and "expect"` });
      return;
    }

    const record = entry as YamlMap;
    const query = asString(record['query'] ?? null);
    if (query === null || query.trim() === '') {
      errors.push({ line, message: `test #${line} is missing a non-empty "query"` });
      return;
    }

    const expect = asString(record['expect'] ?? null);
    if (expect === null || expect.trim() === '') {
      errors.push({
        line,
        message: `test #${line} ("${query.slice(0, 40)}") is missing "expect". `
          + `Use a skill name, or "${EXPECT_NONE}" to assert that nothing should match.`,
      });
      return;
    }

    const testCase: {
      query: string; expect: string; line: number;
      minMargin?: number; avoid?: readonly string[]; note?: string;
    } = { query: query.trim(), expect: expect.trim(), line };

    const minMargin = record['minMargin'];
    if (minMargin !== undefined && minMargin !== null) {
      if (typeof minMargin !== 'number' || !Number.isFinite(minMargin) || minMargin < 0 || minMargin > 1) {
        errors.push({ line, message: `test #${line}: "minMargin" must be a number between 0 and 1` });
        return;
      }
      testCase.minMargin = minMargin;
    }

    const avoid = record['avoid'];
    if (avoid !== undefined && avoid !== null) {
      const parsed = asStringArray(avoid);
      if (parsed === null) {
        errors.push({ line, message: `test #${line}: "avoid" must be a list of skill names` });
        return;
      }
      testCase.avoid = parsed;
    }

    const note = asString(record['note'] ?? null);
    if (note !== null) testCase.note = note;

    cases.push(testCase);
  });

  return { cases, path, errors };
}

export async function loadSuite(path: string): Promise<RoutingTestSuite> {
  const absolute = resolve(path);
  let source: string;

  try {
    source = await readFile(absolute, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const message = code === 'ENOENT'
      ? 'test suite not found'
      : `cannot read test suite: ${error instanceof Error ? error.message : String(error)}`;
    return { cases: [], path: absolute, errors: [{ line: 1, message }] };
  }

  return parseSuite(source, absolute);
}

export type FailureKind =
  | 'wrong-skill'
  | 'expected-none'
  | 'unexpected-none'
  | 'margin-too-low'
  | 'avoided-skill-won'
  | 'unknown-skill';

export interface TestOutcome {
  readonly testCase: RoutingTestCase;
  readonly passed: boolean;
  readonly result: RoutingResult;
  /** Name of the skill that actually ranked first, if any. */
  readonly actual: string | null;
  readonly failure?: FailureKind;
  readonly detail?: string;
}

export interface SuiteRunResult {
  readonly outcomes: readonly TestOutcome[];
  readonly passed: number;
  readonly failed: number;
}

/**
 * Execute a suite against a corpus.
 *
 * An `expect` naming a skill that does not exist fails loudly rather than
 * silently passing or being skipped. A test asserting behaviour about a deleted
 * skill is not a test that should quietly go green — that is precisely how a
 * suite rots into decoration.
 */
export function runSuite(
  suite: RoutingTestSuite,
  corpus: Corpus,
  config: SkillsonarConfig,
): SuiteRunResult {
  const known = new Set(corpus.documents.map((document) => document.skill.name));
  const outcomes: TestOutcome[] = [];

  for (const testCase of suite.cases) {
    const result = route(corpus, testCase.query, {
      scoring: config.scoring,
      thresholds: config.thresholds,
    });

    const top = result.ranked[0];
    const matched = result.verdict !== 'no-match' && top !== undefined;
    const actual = matched && top !== undefined ? top.skill.name : null;

    const fail = (failure: FailureKind, detail: string): void => {
      outcomes.push({ testCase, passed: false, result, actual, failure, detail });
    };

    if (testCase.expect !== EXPECT_NONE && !known.has(testCase.expect)) {
      fail('unknown-skill',
        `no skill named "${testCase.expect}" exists in the scanned collection. `
        + 'Fix the expectation, or the test is asserting nothing.');
      continue;
    }

    if (testCase.expect === EXPECT_NONE) {
      if (matched) {
        fail('expected-none', `expected no match, but "${actual}" scored ${top?.score.toFixed(2)}`);
      } else {
        outcomes.push({ testCase, passed: true, result, actual });
      }
      continue;
    }

    if (!matched) {
      fail('unexpected-none',
        `expected "${testCase.expect}" but nothing matched: the best skill captured only `
        + `${(result.coverage * 100).toFixed(0)}% of this query's discriminative weight, `
        + `below the ${(config.thresholds.minimumCoverage * 100).toFixed(0)}% minimum`);
      continue;
    }

    if (actual !== testCase.expect) {
      const expectedRank = result.ranked.findIndex((entry) => entry.skill.name === testCase.expect);
      const position = expectedRank === -1
        ? 'did not score at all'
        : `ranked #${expectedRank + 1} with ${result.ranked[expectedRank]?.score.toFixed(2)}`;
      fail('wrong-skill', `expected "${testCase.expect}" but "${actual}" won; "${testCase.expect}" ${position}`);
      continue;
    }

    if (testCase.avoid !== undefined && testCase.avoid.includes(actual)) {
      fail('avoided-skill-won', `"${actual}" is listed in "avoid" but ranked first`);
      continue;
    }

    if (testCase.minMargin !== undefined && result.margin < testCase.minMargin) {
      const runnerUp = result.ranked[1]?.skill.name ?? 'nothing';
      fail('margin-too-low',
        `"${actual}" won but only by ${(result.margin * 100).toFixed(0)}%, `
        + `below the required ${(testCase.minMargin * 100).toFixed(0)}% (closest rival: "${runnerUp}")`);
      continue;
    }

    outcomes.push({ testCase, passed: true, result, actual });
  }

  const passed = outcomes.filter((outcome) => outcome.passed).length;
  return { outcomes, passed, failed: outcomes.length - passed };
}
