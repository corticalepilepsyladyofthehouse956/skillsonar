import { relative } from 'node:path';
import { countDiagnostics, ruleTitle, type AnalysisResult } from '../analyze.ts';
import type { SuiteRunResult } from '../testing/suite.ts';
import type { Corpus } from '../analysis/corpus.ts';
import type { RoutingResult } from '../types.ts';

/**
 * Machine-readable output.
 *
 * The schema is versioned and paths are emitted relative to the scan root, so
 * a report produced on a developer's laptop and one produced in CI are
 * byte-identical for identical inputs. That is what makes `skillsonar scan
 * --json` usable as a committed artefact you can diff across commits to see
 * exactly which routing relationships a change disturbed.
 */

/** Bumped only on breaking schema changes. */
export const REPORT_SCHEMA_VERSION = 1;

function toRelative(path: string, cwd: string): string {
  const rel = relative(cwd, path);
  return rel === '' || rel.startsWith('..') ? path : rel.split('\\').join('/');
}

export function scanToJson(result: AnalysisResult, cwd = process.cwd()): string {
  const counts = countDiagnostics(result.diagnostics);

  return `${JSON.stringify({
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: 'skillsonar',
    summary: {
      skills: result.skills.length,
      errors: counts.error,
      warnings: counts.warning,
      info: counts.info,
      collisions: result.collisions.collisions.length,
      stolenSignatures: result.collisions.stolen.length,
    },
    diagnostics: result.diagnostics.map((diagnostic) => ({
      rule: diagnostic.rule,
      ruleTitle: ruleTitle(diagnostic.rule),
      severity: diagnostic.severity,
      message: diagnostic.message,
      hint: diagnostic.hint ?? null,
      skill: diagnostic.skill ?? null,
      file: toRelative(diagnostic.file, cwd),
      line: diagnostic.line ?? null,
    })),
    collisions: result.collisions.collisions.map((collision) => ({
      severity: collision.severity,
      similarity: Number(collision.similarity.toFixed(4)),
      skills: [collision.a.skill.name, collision.b.skill.name],
      files: [toRelative(collision.a.skill.path, cwd), toRelative(collision.b.skill.path, cwd)],
      sharedTerms: collision.sharedTerms.slice(0, 12).map((term) => ({
        term: term.surface,
        documentFrequency: term.documentFrequency,
        idf: Number(term.weight.toFixed(4)),
      })),
      uniqueTerms: {
        [collision.a.skill.name]: collision.uniqueToA.slice(0, 12),
        [collision.b.skill.name]: collision.uniqueToB.slice(0, 12),
      },
    })),
    stolenSignatures: result.collisions.stolen.map((probe) => ({
      skill: probe.document.skill.name,
      file: toRelative(probe.document.skill.path, cwd),
      probe: probe.probe,
      stolenBy: probe.stolenBy ?? null,
    })),
    budget: {
      contextWindow: result.budget.contextWindow,
      totalResidentTokens: result.budget.totalResidentTokens,
      totalDeferredTokens: result.budget.totalDeferredTokens,
      residentShare: Number(result.budget.residentShare.toFixed(6)),
      estimateAccuracy: '±10-15% versus a real BPE tokenizer',
      skills: result.budget.heaviest.map((entry) => ({
        skill: entry.skill.name,
        file: toRelative(entry.skill.path, cwd),
        residentTokens: entry.residentTokens,
        deferredTokens: entry.deferredTokens,
        descriptionCharacters: entry.descriptionCharacters,
      })),
    },
    warnings: result.warnings.map((warning) => ({
      path: toRelative(warning.path, cwd),
      message: warning.message,
    })),
  }, null, 2)}\n`;
}

export function routeToJson(result: RoutingResult, corpus: Corpus): string {
  return `${JSON.stringify({
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: 'skillsonar',
    query: result.query,
    verdict: result.verdict,
    margin: Number(result.margin.toFixed(4)),
    coverage: Number(result.coverage.toFixed(4)),
    corpusSize: corpus.size,
    ranked: result.ranked.map((entry, index) => ({
      rank: index + 1,
      skill: entry.skill.name,
      score: Number(entry.score.toFixed(4)),
      terms: entry.contributions.map((contribution) => ({
        term: contribution.surface,
        weight: Number(contribution.weight.toFixed(4)),
        documentFrequency: contribution.documentFrequency,
      })),
    })),
  }, null, 2)}\n`;
}

export function testsToJson(run: SuiteRunResult, suitePath: string, cwd = process.cwd()): string {
  return `${JSON.stringify({
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: 'skillsonar',
    suite: toRelative(suitePath, cwd),
    passed: run.passed,
    failed: run.failed,
    total: run.outcomes.length,
    results: run.outcomes.map((outcome) => ({
      query: outcome.testCase.query,
      expected: outcome.testCase.expect,
      actual: outcome.actual,
      passed: outcome.passed,
      failure: outcome.failure ?? null,
      detail: outcome.detail ?? null,
      margin: Number(outcome.result.margin.toFixed(4)),
      ranked: outcome.result.ranked.slice(0, 3).map((entry) => ({
        skill: entry.skill.name,
        score: Number(entry.score.toFixed(4)),
      })),
    })),
  }, null, 2)}\n`;
}
