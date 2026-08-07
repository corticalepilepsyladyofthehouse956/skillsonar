import { relative } from 'node:path';
import { countDiagnostics, ruleTitle, type AnalysisResult } from '../analyze.ts';
import type { SuiteRunResult } from '../testing/suite.ts';
import type { Diagnostic } from '../types.ts';

/**
 * Markdown output, sized for a pull-request comment.
 *
 * Deliberately not a transcription of the terminal report. A PR comment is read
 * by someone who did not run the tool and may not know what it measures, so
 * this format leads with the count, collapses detail behind `<details>`, and
 * explains what a collision *is* before listing any. The terminal report can
 * assume its reader typed the command.
 */

const ICON = { error: '🔴', warning: '🟡', info: '⚪' } as const;

function toRelative(path: string, cwd: string): string {
  const rel = relative(cwd, path);
  return rel === '' || rel.startsWith('..') ? path : rel.split('\\').join('/');
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function diagnosticRows(diagnostics: readonly Diagnostic[], cwd: string): string[] {
  return diagnostics.map((diagnostic) => {
    const location = `\`${toRelative(diagnostic.file, cwd)}${diagnostic.line === undefined ? '' : `:${diagnostic.line}`}\``;
    return `| ${ICON[diagnostic.severity]} | \`${diagnostic.rule}\` | ${escapeCell(diagnostic.skill ?? '—')} `
      + `| ${escapeCell(diagnostic.message)} | ${location} |`;
  });
}

export function scanToMarkdown(result: AnalysisResult, cwd = process.cwd()): string {
  const counts = countDiagnostics(result.diagnostics);
  const lines: string[] = ['## skillsonar', ''];

  if (result.skills.length === 0) {
    lines.push('No `SKILL.md` files were found in the scanned paths.', '');
    return lines.join('\n');
  }

  const headline = counts.total === 0
    ? `✅ **No issues** across ${result.skills.length} skills.`
    : `Found **${counts.error} error${counts.error === 1 ? '' : 's'}**, `
      + `**${counts.warning} warning${counts.warning === 1 ? '' : 's'}** and `
      + `**${counts.info} info** across ${result.skills.length} skills.`;

  lines.push(headline, '');

  if (counts.total > 0) {
    lines.push('| | Rule | Skill | Finding | Location |', '|---|---|---|---|---|');
    lines.push(...diagnosticRows(result.diagnostics.slice(0, 40), cwd));
    if (result.diagnostics.length > 40) {
      lines.push('', `_… and ${result.diagnostics.length - 40} more findings._`);
    }
    lines.push('');
  }

  if (result.collisions.collisions.length > 0) {
    lines.push('<details>', '<summary>Routing collisions</summary>', '');
    lines.push(
      'Two skills *collide* when they respond near-identically to the same queries, which means an '
      + 'agent has no reliable basis for choosing between them. Similarity is the cosine of their '
      + 'routing response vectors, so common words across the collection are already discounted.',
      '',
    );
    lines.push('| Similarity | Skills | Severity |', '|---|---|---|');
    for (const collision of result.collisions.collisions.slice(0, 20)) {
      lines.push(
        `| ${Math.round(collision.similarity * 100)}% `
        + `| \`${escapeCell(collision.a.skill.name)}\` ↔ \`${escapeCell(collision.b.skill.name)}\` `
        + `| ${collision.severity} |`,
      );
    }
    lines.push('', '</details>', '');
  }

  const share = (result.budget.residentShare * 100).toFixed(2);
  lines.push(
    `**Context budget** — approximately ${result.budget.totalResidentTokens.toLocaleString('en-US')} resident tokens `
    + `(${share}% of a ${result.budget.contextWindow.toLocaleString('en-US')}-token window), loaded on every request. `
    + `Bodies add ~${result.budget.totalDeferredTokens.toLocaleString('en-US')} tokens, loaded only on trigger.`,
    '',
    '<sub>Static lexical analysis — deterministic and offline. It detects when descriptions provide '
    + 'insufficient signal to distinguish skills; it does not predict any specific model\'s choice.</sub>',
    '',
  );

  return lines.join('\n');
}

export function testsToMarkdown(run: SuiteRunResult): string {
  const lines: string[] = ['## skillsonar — routing tests', ''];

  if (run.failed === 0) {
    lines.push(`✅ All **${run.passed}** routing tests passed.`, '');
    return lines.join('\n');
  }

  lines.push(`❌ **${run.failed}** of ${run.outcomes.length} routing tests failed.`, '');
  lines.push('| Query | Expected | Actual | Why |', '|---|---|---|---|');

  for (const outcome of run.outcomes) {
    if (outcome.passed) continue;
    lines.push(
      `| ${escapeCell(outcome.testCase.query)} `
      + `| \`${escapeCell(outcome.testCase.expect)}\` `
      + `| ${outcome.actual === null ? '_no match_' : `\`${escapeCell(outcome.actual)}\``} `
      + `| ${escapeCell(outcome.detail ?? '')} |`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

/** Expose the rule title helper for consumers building custom Markdown. */
export { ruleTitle };
