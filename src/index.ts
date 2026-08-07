/**
 * Public API.
 *
 * The CLI is the primary interface, but the analysis engine is exported so it
 * can be embedded — a skill marketplace validating submissions at upload time,
 * an editor extension surfacing collisions while a description is being typed,
 * or a custom report that needs the raw scores rather than a rendering of them.
 *
 * Everything here is pure and synchronous apart from filesystem access, and
 * nothing reaches the network.
 */

export { analyze, countDiagnostics, ruleTitle } from './analyze.ts';
export type { AnalysisResult, AnalyzeOptions, DiagnosticCounts } from './analyze.ts';

export { discoverSkills, CONVENTIONAL_ROOTS } from './skills/discover.ts';
export type { DiscoveryOptions, DiscoveryResult, DiscoveryWarning } from './skills/discover.ts';

export { parseFrontmatter, parseYaml } from './skills/frontmatter.ts';
export type { FrontmatterResult, FrontmatterError, YamlMap, YamlValue } from './skills/frontmatter.ts';

export { buildCorpus } from './analysis/corpus.ts';
export type { Corpus, IndexedSkill, FieldIndex } from './analysis/corpus.ts';

export { scoreDocument, DEFAULT_SCORING } from './analysis/bm25.ts';
export type { ScoringParameters, ScoreBreakdown } from './analysis/bm25.ts';

export { route, signatureTerms, selfProbe, DEFAULT_THRESHOLDS } from './analysis/router.ts';
export type { RouteOptions, RoutingThresholds, SelfProbe } from './analysis/router.ts';

export { findCollisions, findWeakSignals, DEFAULT_COLLISION_THRESHOLDS } from './analysis/collisions.ts';
export type {
  Collision, CollisionOptions, CollisionReport, CollisionSeverity, CollisionThresholds, WeakSignal,
} from './analysis/collisions.ts';

export { analyseBudget, estimateTokens } from './analysis/budget.ts';
export type { BudgetOptions, BudgetReport, SkillBudget } from './analysis/budget.ts';

export { tokenize, uniqueTerms } from './text/tokenize.ts';
export type { Token, TokenizeOptions } from './text/tokenize.ts';
export { stem } from './text/stemmer.ts';
export { DEFAULT_STOPWORDS, ENGLISH_STOPWORDS, SKILL_BOILERPLATE_STOPWORDS } from './text/stopwords.ts';

export { parseSuite, loadSuite, runSuite, EXPECT_NONE } from './testing/suite.ts';
export type {
  RoutingTestCase, RoutingTestSuite, SuiteRunResult, TestOutcome, FailureKind,
} from './testing/suite.ts';

export { loadConfig, parseConfig, defaultConfig, ConfigError, CONFIG_FILENAME } from './config.ts';
export type { SkillsonarConfig, RuleSetting, BudgetLimits } from './config.ts';

export { RULES, RULE_IDS, ruleOf } from './rules/catalog.ts';
export type { RuleDefinition, RuleId } from './rules/catalog.ts';

export { scanToJson, routeToJson, testsToJson, REPORT_SCHEMA_VERSION } from './report/json.ts';
export { scanToSarif } from './report/sarif.ts';
export { scanToMarkdown, testsToMarkdown } from './report/markdown.ts';

export type {
  Diagnostic, RoutingResult, RoutingVerdict, Severity, Skill, SkillScore, TermContribution,
} from './types.ts';
