import { relative } from 'node:path';
import { createStyler, bar, padEnd, padStart, truncate, type Styler } from './style.ts';
import { countDiagnostics, ruleTitle, type AnalysisResult } from '../analyze.ts';
import type { Corpus, IndexedSkill } from '../analysis/corpus.ts';
import type { SuiteRunResult } from '../testing/suite.ts';
import type { BudgetReport } from '../analysis/budget.ts';
import type { Diagnostic, RoutingResult, RoutingVerdict, TermContribution } from '../types.ts';

/**
 * Human-facing output.
 *
 * Two principles shape everything here.
 *
 * First, a finding is not useful until the reader knows what to change. Every
 * diagnostic prints its remediation directly beneath it rather than referring
 * the reader to documentation, because the moment someone is looking at a
 * failing CI log is the moment they are least willing to open a browser.
 *
 * Second, uncertainty is shown, not hidden. Scores appear with the margin that
 * separates them, and verdicts derived from thresholds say so. A tool that
 * reports "invoice-parser wins" invites more trust than it has earned; one that
 * reports "invoice-parser wins by 4% — effectively a coin flip" tells the truth.
 */

export interface TerminalOptions {
  readonly styler: Styler;
  /** Base directory for shortening paths. Defaults to `process.cwd()`. */
  readonly cwd?: string;
  /** Terminal width for bars and truncation. Defaults to 100, clamped to 60–120. */
  readonly width?: number;
}

export function terminalOptions(stream: NodeJS.WriteStream, cwd = process.cwd()): TerminalOptions {
  const detected = stream.columns ?? 100;
  return {
    styler: createStyler(stream),
    cwd,
    width: Math.max(60, Math.min(120, detected)),
  };
}

function shorten(path: string, cwd: string): string {
  const rel = relative(cwd, path);
  return rel === '' || rel.startsWith('..') ? path : rel.split('\\').join('/');
}

const SEVERITY_MARK = { error: '✖', warning: '▲', info: '·' } as const;
const SEVERITY_COLOUR = { error: 'red', warning: 'yellow', info: 'grey' } as const;

const VERDICT_COLOUR: Record<RoutingVerdict, 'green' | 'yellow' | 'red' | 'grey'> = {
  confident: 'green',
  contested: 'yellow',
  ambiguous: 'red',
  'no-match': 'grey',
};

const VERDICT_EXPLANATION: Record<RoutingVerdict, string> = {
  confident: 'clear winner by a wide margin',
  contested: 'winner is leading, but the gap is narrow enough to be fragile',
  ambiguous: 'top two are effectively tied — selection here is arbitrary',
  'no-match': 'nothing scored high enough to be a meaningful match',
};

/** Wrap text to `width`, indenting every line by `indent` spaces. */
function wrap(text: string, width: number, indent: number): string[] {
  const limit = Math.max(20, width - indent);
  const pad = ' '.repeat(indent);
  const lines: string[] = [];
  let current = '';

  for (const word of text.split(/\s+/)) {
    if (word === '') continue;
    if (current === '') {
      current = word;
    } else if (current.length + 1 + word.length <= limit) {
      current += ` ${word}`;
    } else {
      lines.push(pad + current);
      current = word;
    }
  }
  if (current !== '') lines.push(pad + current);
  return lines;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

function renderDiagnostic(diagnostic: Diagnostic, options: TerminalOptions): string[] {
  const { styler } = options;
  const cwd = options.cwd ?? process.cwd();
  const width = options.width ?? 100;

  const colour = SEVERITY_COLOUR[diagnostic.severity];
  const mark = styler(colour, SEVERITY_MARK[diagnostic.severity]);
  const rule = styler('grey', `${diagnostic.rule} ${ruleTitle(diagnostic.rule)}`);
  const subject = diagnostic.skill === undefined ? '' : ` ${styler('bold', diagnostic.skill)}`;

  const lines = [`  ${mark}  ${rule}${subject}`];
  lines.push(...wrap(diagnostic.message, width, 5));

  if (diagnostic.hint !== undefined) {
    const hint = wrap(diagnostic.hint, width, 5);
    lines.push(...hint.map((line, index) =>
      index === 0
        ? `     ${styler('cyan', '→')} ${styler('dim', line.trimStart())}`
        : `       ${styler('dim', line.trimStart())}`));
  }

  const location = `${shorten(diagnostic.file, cwd)}${diagnostic.line === undefined ? '' : `:${diagnostic.line}`}`;
  lines.push(`     ${styler('grey', location)}`);
  lines.push('');

  return lines;
}

export function renderDiagnostics(diagnostics: readonly Diagnostic[], options: TerminalOptions): string {
  if (diagnostics.length === 0) return '';
  return diagnostics.flatMap((diagnostic) => renderDiagnostic(diagnostic, options)).join('\n');
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

function renderSummaryLine(result: AnalysisResult, options: TerminalOptions): string {
  const { styler } = options;
  const counts = countDiagnostics(result.diagnostics);

  if (counts.total === 0) {
    return styler('green', `  ✔  No issues found across ${result.skills.length} skills.`);
  }

  const parts: string[] = [];
  if (counts.error > 0) parts.push(styler('red', `${counts.error} error${counts.error === 1 ? '' : 's'}`));
  if (counts.warning > 0) parts.push(styler('yellow', `${counts.warning} warning${counts.warning === 1 ? '' : 's'}`));
  if (counts.info > 0) parts.push(styler('grey', `${counts.info} info`));

  return `  ${parts.join(styler('grey', '  ·  '))}`;
}

function renderCollisionTable(result: AnalysisResult, options: TerminalOptions): string[] {
  const { styler } = options;
  const width = options.width ?? 100;
  const collisions = result.collisions.collisions.slice(0, 10);
  if (collisions.length === 0) return [];

  const nameWidth = Math.max(12, Math.floor((width - 34) / 2));
  const lines = [styler('bold', '  Routing collisions'), ''];

  for (const collision of collisions) {
    const colour = collision.severity === 'critical' ? 'red' : collision.severity === 'high' ? 'yellow' : 'grey';
    const percentage = padStart(`${Math.round(collision.similarity * 100)}%`, 4);

    lines.push(
      `    ${styler(colour, percentage)}  `
      + `${padEnd(truncate(collision.a.skill.name, nameWidth), nameWidth)} `
      + `${styler('grey', '↔')} `
      + `${padEnd(truncate(collision.b.skill.name, nameWidth), nameWidth)} `
      + styler('grey', collision.severity),
    );
  }

  const hidden = result.collisions.collisions.length - collisions.length;
  if (hidden > 0) lines.push(styler('grey', `    … and ${hidden} more pairs`));
  lines.push('');

  return lines;
}

function renderBudgetSummary(budget: BudgetReport, options: TerminalOptions): string[] {
  const { styler } = options;
  const share = budget.residentShare;
  const colour = share > 0.1 ? 'red' : share > 0.05 ? 'yellow' : 'green';

  return [
    styler('bold', '  Context budget'),
    '',
    `    ${styler('grey', 'resident')}  ${styler(colour, `~${formatNumber(budget.totalResidentTokens)} tokens`)}`
    + ` ${styler('grey', `(${(share * 100).toFixed(2)}% of ${formatNumber(budget.contextWindow)}, loaded every request)`)}`,
    `    ${styler('grey', 'deferred')}  ${styler('grey', `~${formatNumber(budget.totalDeferredTokens)} tokens (bodies, loaded on trigger)`)}`,
    '',
  ];
}

export function renderScan(result: AnalysisResult, options: TerminalOptions): string {
  const { styler } = options;
  const cwd = options.cwd ?? process.cwd();
  const lines: string[] = [''];

  const roots = result.roots.map((root) => shorten(root, cwd)).join(', ');
  lines.push(
    `  ${styler('bold', 'skillsonar')}  ${styler('grey', '·')}  `
    + `${result.skills.length} skill${result.skills.length === 1 ? '' : 's'}  ${styler('grey', '·')}  `
    + styler('grey', roots || '.'),
  );
  lines.push('');

  if (result.skills.length === 0) {
    lines.push(styler('yellow', '  No SKILL.md files found.'));
    lines.push(styler('grey', '  Looked for SKILL.md under the given paths and the conventional'));
    lines.push(styler('grey', '  skill roots (.claude/skills, .agent/skills, skills, …).'));
    lines.push('');
    return lines.join('\n');
  }

  for (const warning of result.warnings) {
    lines.push(`  ${styler('yellow', '▲')}  ${warning.message}`);
    lines.push(`     ${styler('grey', shorten(warning.path, cwd))}`);
    lines.push('');
  }

  const rendered = renderDiagnostics(result.diagnostics, options);
  if (rendered !== '') lines.push(rendered);

  lines.push(...renderCollisionTable(result, options));
  lines.push(...renderBudgetSummary(result.budget, options));
  lines.push(renderSummaryLine(result, options));
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

function renderContributions(contributions: readonly TermContribution[], styler: Styler, corpusSize: number): string {
  if (contributions.length === 0) return styler('grey', 'no matching terms');

  return contributions
    .slice(0, 5)
    .map((contribution) => {
      // A term present in most of the corpus is dimmed, because its numeric
      // contribution understates how little it distinguishes anything.
      const common = corpusSize > 0 && contribution.documentFrequency / corpusSize > 0.5;
      const label = `${contribution.surface}${styler('grey', `:${contribution.weight.toFixed(2)}`)}`;
      return common ? styler('grey', `${contribution.surface}:${contribution.weight.toFixed(2)}`) : label;
    })
    .join(styler('grey', '  '));
}

export function renderRoute(result: RoutingResult, corpus: Corpus, options: TerminalOptions): string {
  const { styler } = options;
  const width = options.width ?? 100;
  const lines: string[] = ['', `  ${styler('bold', 'query')}  ${result.query}`, ''];

  if (result.ranked.length === 0) {
    lines.push(styler('grey', '  Nothing matched. No skill shares any distinctive term with this query.'));
    lines.push('');
    return lines.join('\n');
  }

  const top = result.ranked[0]?.score ?? 1;
  const nameWidth = Math.min(30, Math.max(...result.ranked.map((entry) => entry.skill.name.length)));
  const barWidth = Math.max(10, Math.min(24, width - nameWidth - 30));

  result.ranked.forEach((entry, index) => {
    const isTop = index === 0;
    const name = padEnd(truncate(entry.skill.name, nameWidth), nameWidth);
    const graph = bar(entry.score / top, barWidth);

    lines.push(
      `  ${styler('grey', padStart(`${index + 1}.`, 3))} `
      + `${isTop ? styler('bold', name) : name} `
      + `${styler(isTop ? 'cyan' : 'grey', graph)} `
      + `${padStart(entry.score.toFixed(2), 6)}`,
    );
    lines.push(`      ${styler('grey', 'on')} ${renderContributions(entry.contributions, styler, corpus.size)}`);
  });

  lines.push('');

  const colour = VERDICT_COLOUR[result.verdict];
  lines.push(
    `  ${styler(colour, result.verdict)}  `
    + styler('grey',
      `margin ${(result.margin * 100).toFixed(0)}%, `
      + `coverage ${(result.coverage * 100).toFixed(0)}% — ${VERDICT_EXPLANATION[result.verdict]}`),
  );
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Explain
// ---------------------------------------------------------------------------

export function renderExplain(
  document: IndexedSkill,
  signature: readonly TermContribution[],
  corpus: Corpus,
  options: TerminalOptions,
): string {
  const { styler } = options;
  const width = options.width ?? 100;
  const lines: string[] = ['', `  ${styler('bold', document.skill.name)}`, ''];

  lines.push(...wrap(document.skill.description || '(no description)', width, 2).map((line) => styler('grey', line)));
  lines.push('');
  lines.push(`  ${styler('bold', 'Routing vocabulary')} ${styler('grey', `(across ${corpus.size} skills)`)}`);
  lines.push('');

  if (signature.length === 0) {
    lines.push(styler('yellow', '    This skill has no indexable terms at all.'));
    lines.push('');
    return lines.join('\n');
  }

  const termWidth = Math.min(22, Math.max(...signature.map((term) => term.surface.length)) + 1);
  const best = signature[0]?.weight ?? 1;

  for (const term of signature) {
    const share = corpus.size === 0 ? 0 : term.documentFrequency / corpus.size;
    const colour = share > 0.5 ? 'grey' : share > 0.25 ? 'yellow' : 'green';
    const note = term.documentFrequency === 1
      ? 'unique to this skill'
      : `in ${term.documentFrequency}/${corpus.size} skills`;

    lines.push(
      `    ${padEnd(term.surface, termWidth)} `
      + `${styler(colour, bar(term.weight / best, 16))} `
      + `${padStart(term.weight.toFixed(2), 5)}  ${styler('grey', note)}`,
    );
  }

  lines.push('');
  const dead = signature.filter((term) => corpus.size > 2 && term.documentFrequency / corpus.size > 0.5);
  if (dead.length > 0) {
    lines.push(...wrap(
      `Dimmed terms appear in more than half the collection and contribute almost nothing to `
      + `selection. This skill is effectively competing on ${signature.length - dead.length} `
      + `distinctive term${signature.length - dead.length === 1 ? '' : 's'}.`,
      width, 4,
    ).map((line) => styler('grey', line)));
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export function renderTestResults(run: SuiteRunResult, options: TerminalOptions): string {
  const { styler } = options;
  const width = options.width ?? 100;
  const lines: string[] = [''];

  for (const outcome of run.outcomes) {
    if (outcome.passed) {
      lines.push(
        `  ${styler('green', '✔')}  ${styler('grey', truncate(outcome.testCase.query, width - 8))}`,
      );
      continue;
    }

    lines.push(`  ${styler('red', '✖')}  ${truncate(outcome.testCase.query, width - 8)}`);
    if (outcome.detail !== undefined) {
      lines.push(...wrap(outcome.detail, width, 5).map((line) => styler('red', line)));
    }
    if (outcome.testCase.note !== undefined) {
      lines.push(...wrap(`note: ${outcome.testCase.note}`, width, 5).map((line) => styler('grey', line)));
    }

    // Showing the actual ranking turns "this failed" into "this failed and here
    // is the skill that beat it, by this much" — usually enough to fix it
    // without rerunning anything.
    const podium = outcome.result.ranked.slice(0, 3);
    if (podium.length > 0) {
      const ranking = podium
        .map((entry, index) => `${index + 1}. ${entry.skill.name} ${entry.score.toFixed(2)}`)
        .join('   ');
      lines.push(`     ${styler('grey', ranking)}`);
    }
    lines.push('');
  }

  lines.push('');
  const summary = run.failed === 0
    ? styler('green', `  ✔  ${run.passed}/${run.outcomes.length} routing tests passed`)
    : styler('red', `  ✖  ${run.failed} of ${run.outcomes.length} routing tests failed`);
  lines.push(summary);
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export function renderBudget(budget: BudgetReport, options: TerminalOptions): string {
  const { styler } = options;
  const width = options.width ?? 100;
  const lines: string[] = ['', `  ${styler('bold', 'Context budget')}`, ''];

  if (budget.skills.length === 0) {
    lines.push(styler('grey', '  No skills to measure.'));
    lines.push('');
    return lines.join('\n');
  }

  const nameWidth = Math.min(32, Math.max(...budget.skills.map((entry) => entry.skill.name.length)));
  const heaviest = budget.heaviest[0]?.residentTokens ?? 1;
  const barWidth = Math.max(10, Math.min(20, width - nameWidth - 34));

  lines.push(
    `  ${padEnd(styler('grey', 'skill'), nameWidth)} ${' '.repeat(barWidth)} `
    + `${styler('grey', 'resident')}  ${styler('grey', 'deferred')}`,
  );

  for (const entry of budget.heaviest) {
    const overBudget = entry.residentTokens > heaviest * 0.8;
    lines.push(
      `  ${padEnd(truncate(entry.skill.name, nameWidth), nameWidth)} `
      + `${styler(overBudget ? 'yellow' : 'grey', bar(entry.residentTokens / heaviest, barWidth))} `
      + `${padStart(formatNumber(entry.residentTokens), 8)}  `
      + styler('grey', padStart(formatNumber(entry.deferredTokens), 8)),
    );
  }

  lines.push('');
  lines.push(
    `  ${styler('bold', 'total resident')}  ~${formatNumber(budget.totalResidentTokens)} tokens `
    + styler('grey', `(${(budget.residentShare * 100).toFixed(2)}% of a ${formatNumber(budget.contextWindow)}-token window)`),
  );
  lines.push('');
  lines.push(...wrap(
    'Resident cost is paid on every request whether or not a skill fires. Deferred cost is the '
    + 'body, paid only on trigger. Token counts are estimates within roughly 10-15% of a real '
    + 'tokenizer; the comparison between skills is more accurate than the absolute figures.',
    width, 2,
  ).map((line) => styler('grey', line)));
  lines.push('');

  return lines.join('\n');
}
