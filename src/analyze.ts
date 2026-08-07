import { discoverSkills, type DiscoveryWarning } from './skills/discover.ts';
import { buildCorpus, type Corpus } from './analysis/corpus.ts';
import { findCollisions, findWeakSignals, type CollisionReport, type WeakSignal } from './analysis/collisions.ts';
import { analyseBudget, type BudgetReport } from './analysis/budget.ts';
import { checkStructure, checkDuplicateNames } from './rules/structure.ts';
import { checkCollisions, checkStolenSignatures, checkWeakSignals } from './rules/routing.ts';
import { RULES, type RuleId } from './rules/catalog.ts';
import type { SkillsonarConfig } from './config.ts';
import type { Diagnostic, Severity, Skill } from './types.ts';

export interface AnalysisResult {
  readonly skills: readonly Skill[];
  readonly corpus: Corpus;
  readonly diagnostics: readonly Diagnostic[];
  readonly collisions: CollisionReport;
  readonly weakSignals: readonly WeakSignal[];
  readonly budget: BudgetReport;
  readonly warnings: readonly DiscoveryWarning[];
  readonly roots: readonly string[];
  readonly config: SkillsonarConfig;
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/**
 * Apply configured severities and drop disabled rules.
 *
 * Severity is resolved here rather than at each call site so that a rule's
 * emitted severity and its configured severity can never drift apart. Checks
 * report their natural severity; configuration has the final word.
 */
function applyRuleConfig(
  diagnostics: readonly Diagnostic[],
  config: SkillsonarConfig,
): Diagnostic[] {
  const result: Diagnostic[] = [];

  for (const diagnostic of diagnostics) {
    const setting = config.rules[diagnostic.rule as RuleId];
    if (setting === 'off') continue;
    if (setting === undefined) {
      result.push(diagnostic);
      continue;
    }
    result.push(setting === diagnostic.severity ? diagnostic : { ...diagnostic, severity: setting });
  }

  return result;
}

/**
 * Order findings the way a reader wants them: worst first, then grouped by
 * file so that fixing one file means fixing a contiguous run of output, then
 * by line, then by rule id so the ordering is total and therefore stable.
 */
function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.sort((a, b) =>
    (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    || a.file.localeCompare(b.file)
    || ((a.line ?? 0) - (b.line ?? 0))
    || a.rule.localeCompare(b.rule));
}

export interface AnalyzeOptions {
  /** Skip filesystem checks for bundled references (SR015). */
  readonly skipReferenceChecks?: boolean;
  /** Minimum collision severity to report. Defaults to `moderate`. */
  readonly minimumCollisionSeverity?: 'critical' | 'high' | 'moderate';
}

/**
 * Discover, index and analyse a skill collection.
 *
 * The whole pipeline is deterministic and offline: the same inputs produce
 * byte-identical output on any machine. That is what makes the result safe to
 * commit, diff between branches, and gate a pull request on.
 */
export async function analyze(
  paths: readonly string[],
  config: SkillsonarConfig,
  options: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const discovery = await discoverSkills(paths, {
    followSymlinks: config.followSymlinks,
    maxDepth: config.maxDepth,
    exclude: config.exclude,
  });

  const corpus = buildCorpus(discovery.skills);
  const collisions = findCollisions(corpus, {
    scoring: config.scoring,
    thresholds: config.collisions,
  });
  const weakSignals = findWeakSignals(corpus);
  const budget = analyseBudget(discovery.skills, { contextWindow: config.budget.contextWindow });

  const raw: Diagnostic[] = [];

  for (const skill of discovery.skills) {
    raw.push(...await checkStructure(skill, {
      budget: config.budget,
      checkReferences: options.skipReferenceChecks !== true,
    }));
  }

  raw.push(...checkDuplicateNames(discovery.skills));
  raw.push(...checkCollisions(collisions, options.minimumCollisionSeverity ?? 'moderate'));
  raw.push(...checkStolenSignatures(collisions));
  raw.push(...checkWeakSignals(weakSignals));

  return {
    skills: discovery.skills,
    corpus,
    diagnostics: sortDiagnostics(applyRuleConfig(raw, config)),
    collisions,
    weakSignals,
    budget,
    warnings: discovery.warnings,
    roots: discovery.roots,
    config,
  };
}

export interface DiagnosticCounts {
  readonly error: number;
  readonly warning: number;
  readonly info: number;
  readonly total: number;
}

export function countDiagnostics(diagnostics: readonly Diagnostic[]): DiagnosticCounts {
  let error = 0;
  let warning = 0;
  let info = 0;

  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 'error') error += 1;
    else if (diagnostic.severity === 'warning') warning += 1;
    else info += 1;
  }

  return { error, warning, info, total: diagnostics.length };
}

/** Human-readable title for a rule id, for reporters that show rule names. */
export function ruleTitle(id: string): string {
  return RULES[id as RuleId]?.title ?? id;
}
