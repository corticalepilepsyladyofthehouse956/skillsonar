import { readFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { RULE_IDS, RULES, type RuleId } from './rules/catalog.ts';
import { DEFAULT_SCORING, type ScoringParameters } from './analysis/bm25.ts';
import { DEFAULT_THRESHOLDS, type RoutingThresholds } from './analysis/router.ts';
import { DEFAULT_COLLISION_THRESHOLDS, type CollisionThresholds } from './analysis/collisions.ts';
import type { Severity } from './types.ts';

export const CONFIG_FILENAME = 'skillsonar.config.json';

export type RuleSetting = Severity | 'off';

export interface BudgetLimits {
  /** Context window used to compute the resident share. */
  readonly contextWindow: number;
  /** Resident cost above which a single skill is flagged (SR014). */
  readonly maxSkillResidentTokens: number;
  /** Body length above which a skill is flagged (SR016), in tokens. */
  readonly maxBodyTokens: number;
}

export interface SkillsonarConfig {
  readonly rules: Readonly<Record<RuleId, RuleSetting>>;
  readonly scoring: ScoringParameters;
  readonly thresholds: RoutingThresholds;
  readonly collisions: CollisionThresholds;
  readonly budget: BudgetLimits;
  readonly exclude: readonly string[];
  readonly followSymlinks: boolean;
  readonly maxDepth: number;
  /** Absolute path of the file this config came from, when it came from one. */
  readonly sourcePath?: string;
}

export const DEFAULT_BUDGET: BudgetLimits = {
  contextWindow: 200_000,
  maxSkillResidentTokens: 260,
  maxBodyTokens: 6_000,
};

function defaultRules(): Record<RuleId, RuleSetting> {
  const rules = {} as Record<RuleId, RuleSetting>;
  for (const id of RULE_IDS) rules[id] = RULES[id].severity;
  return rules;
}

export function defaultConfig(): SkillsonarConfig {
  return {
    rules: defaultRules(),
    scoring: DEFAULT_SCORING,
    thresholds: DEFAULT_THRESHOLDS,
    collisions: DEFAULT_COLLISION_THRESHOLDS,
    budget: DEFAULT_BUDGET,
    exclude: [],
    followSymlinks: false,
    maxDepth: 8,
  };
}

/** Raised for malformed configuration. Carries a message the user can act on. */
export class ConfigError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(message);
    this.name = 'ConfigError';
    this.path = path;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Keys used as comments.
 *
 * JSON has no comment syntax, so a key beginning with `//` is the established
 * convention for one. Rejecting them would force users to strip the
 * explanation of *why* a rule is switched off, which is the most valuable line
 * in a config file.
 */
function isCommentKey(key: string): boolean {
  return key.trimStart().startsWith('//');
}

/**
 * Read a bounded number from config.
 *
 * Bounds are enforced rather than merely documented because these values feed
 * scoring maths where an out-of-range input does not throw — it silently
 * produces a plausible-looking but meaningless analysis. A `b` of 40 does not
 * crash; it just makes every score wrong. Failing at load time with the valid
 * range is the only way the user finds out.
 */
function readNumber(
  source: Record<string, unknown>,
  key: string,
  path: string,
  scope: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const raw = source[key];
  if (raw === undefined) return fallback;

  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new ConfigError(path, `${scope}.${key} must be a finite number, got ${JSON.stringify(raw)}`);
  }
  if (raw < min || raw > max) {
    throw new ConfigError(path, `${scope}.${key} must be between ${min} and ${max}, got ${raw}`);
  }
  return raw;
}

function readStringArray(
  source: Record<string, unknown>,
  key: string,
  path: string,
  fallback: readonly string[],
): readonly string[] {
  const raw = source[key];
  if (raw === undefined) return fallback;

  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string')) {
    throw new ConfigError(path, `${key} must be an array of strings`);
  }
  return raw as string[];
}

function readBoolean(
  source: Record<string, unknown>,
  key: string,
  path: string,
  fallback: boolean,
): boolean {
  const raw = source[key];
  if (raw === undefined) return fallback;
  if (typeof raw !== 'boolean') throw new ConfigError(path, `${key} must be a boolean`);
  return raw;
}

const VALID_SETTINGS: ReadonlySet<string> = new Set(['error', 'warning', 'info', 'off']);

function parseRules(raw: unknown, path: string): Record<RuleId, RuleSetting> {
  const rules = defaultRules();
  if (raw === undefined) return rules;
  if (!isPlainObject(raw)) throw new ConfigError(path, 'rules must be an object');

  const known = new Set<string>(RULE_IDS);

  for (const [key, value] of Object.entries(raw)) {
    if (isCommentKey(key)) continue;
    if (!known.has(key)) {
      const suggestions = RULE_IDS.filter((id) => RULES[id].title === key);
      const hint = suggestions.length > 0
        ? ` Did you mean "${suggestions[0]}"? Rules are configured by id, not title.`
        : ` Known rule ids: ${RULE_IDS.join(', ')}.`;
      throw new ConfigError(path, `unknown rule "${key}".${hint}`);
    }
    if (typeof value !== 'string' || !VALID_SETTINGS.has(value)) {
      throw new ConfigError(
        path,
        `rules.${key} must be one of "error", "warning", "info", "off", got ${JSON.stringify(value)}`,
      );
    }
    rules[key as RuleId] = value as RuleSetting;
  }

  return rules;
}

function parseScoring(raw: unknown, path: string): ScoringParameters {
  if (raw === undefined) return DEFAULT_SCORING;
  if (!isPlainObject(raw)) throw new ConfigError(path, 'scoring must be an object');

  return {
    k1: readNumber(raw, 'k1', path, 'scoring', 0.1, 10, DEFAULT_SCORING.k1),
    nameLengthNormalisation: readNumber(raw, 'nameLengthNormalisation', path, 'scoring', 0, 1, DEFAULT_SCORING.nameLengthNormalisation),
    descriptionLengthNormalisation: readNumber(raw, 'descriptionLengthNormalisation', path, 'scoring', 0, 1, DEFAULT_SCORING.descriptionLengthNormalisation),
    nameWeight: readNumber(raw, 'nameWeight', path, 'scoring', 0, 20, DEFAULT_SCORING.nameWeight),
    descriptionWeight: readNumber(raw, 'descriptionWeight', path, 'scoring', 0, 20, DEFAULT_SCORING.descriptionWeight),
  };
}

function parseThresholds(raw: unknown, path: string): RoutingThresholds {
  if (raw === undefined) return DEFAULT_THRESHOLDS;
  if (!isPlainObject(raw)) throw new ConfigError(path, 'thresholds must be an object');

  if ('minimumScore' in raw) {
    throw new ConfigError(
      path,
      'thresholds.minimumScore has been replaced by thresholds.minimumCoverage. '
      + 'The old option was an absolute BM25 score, which is not comparable across '
      + 'collection sizes; minimumCoverage is the share of a query\'s available weight '
      + 'the winner must capture, between 0 and 1 (default 0.15).',
    );
  }

  const thresholds: RoutingThresholds = {
    ambiguousMargin: readNumber(raw, 'ambiguousMargin', path, 'thresholds', 0, 1, DEFAULT_THRESHOLDS.ambiguousMargin),
    contestedMargin: readNumber(raw, 'contestedMargin', path, 'thresholds', 0, 1, DEFAULT_THRESHOLDS.contestedMargin),
    minimumCoverage: readNumber(raw, 'minimumCoverage', path, 'thresholds', 0, 1, DEFAULT_THRESHOLDS.minimumCoverage),
  };

  if (thresholds.ambiguousMargin > thresholds.contestedMargin) {
    throw new ConfigError(
      path,
      `thresholds.ambiguousMargin (${thresholds.ambiguousMargin}) must not exceed `
      + `thresholds.contestedMargin (${thresholds.contestedMargin}); `
      + 'ambiguous is a stricter condition than contested.',
    );
  }

  return thresholds;
}

function parseCollisions(raw: unknown, path: string): CollisionThresholds {
  if (raw === undefined) return DEFAULT_COLLISION_THRESHOLDS;
  if (!isPlainObject(raw)) throw new ConfigError(path, 'collisions must be an object');

  const thresholds: CollisionThresholds = {
    critical: readNumber(raw, 'critical', path, 'collisions', 0, 1, DEFAULT_COLLISION_THRESHOLDS.critical),
    high: readNumber(raw, 'high', path, 'collisions', 0, 1, DEFAULT_COLLISION_THRESHOLDS.high),
    moderate: readNumber(raw, 'moderate', path, 'collisions', 0, 1, DEFAULT_COLLISION_THRESHOLDS.moderate),
  };

  if (!(thresholds.critical >= thresholds.high && thresholds.high >= thresholds.moderate)) {
    throw new ConfigError(
      path,
      'collisions thresholds must satisfy critical >= high >= moderate, got '
      + `${thresholds.critical} / ${thresholds.high} / ${thresholds.moderate}`,
    );
  }

  return thresholds;
}

function parseBudget(raw: unknown, path: string): BudgetLimits {
  if (raw === undefined) return DEFAULT_BUDGET;
  if (!isPlainObject(raw)) throw new ConfigError(path, 'budget must be an object');

  return {
    contextWindow: readNumber(raw, 'contextWindow', path, 'budget', 1_000, 10_000_000, DEFAULT_BUDGET.contextWindow),
    maxSkillResidentTokens: readNumber(raw, 'maxSkillResidentTokens', path, 'budget', 10, 100_000, DEFAULT_BUDGET.maxSkillResidentTokens),
    maxBodyTokens: readNumber(raw, 'maxBodyTokens', path, 'budget', 100, 1_000_000, DEFAULT_BUDGET.maxBodyTokens),
  };
}

const KNOWN_TOP_LEVEL: ReadonlySet<string> = new Set([
  '$schema', 'rules', 'scoring', 'thresholds', 'collisions', 'budget',
  'exclude', 'followSymlinks', 'maxDepth',
]);

/** Validate and normalise a parsed config object. */
export function parseConfig(raw: unknown, path: string): SkillsonarConfig {
  if (!isPlainObject(raw)) throw new ConfigError(path, 'configuration must be a JSON object');

  for (const key of Object.keys(raw)) {
    if (isCommentKey(key)) continue;
    if (!KNOWN_TOP_LEVEL.has(key)) {
      throw new ConfigError(
        path,
        `unknown option "${key}". Valid options: ${[...KNOWN_TOP_LEVEL].filter((k) => k !== '$schema').join(', ')}.`,
      );
    }
  }

  return {
    rules: parseRules(raw['rules'], path),
    scoring: parseScoring(raw['scoring'], path),
    thresholds: parseThresholds(raw['thresholds'], path),
    collisions: parseCollisions(raw['collisions'], path),
    budget: parseBudget(raw['budget'], path),
    exclude: readStringArray(raw, 'exclude', path, []),
    followSymlinks: readBoolean(raw, 'followSymlinks', path, false),
    maxDepth: readNumber(raw, 'maxDepth', path, 'config', 1, 64, 8),
    sourcePath: path,
  };
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') return null;
    throw new ConfigError(path, `cannot read config: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ConfigError(path, `invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Load configuration, searching upward from `startDir` when no explicit path is
 * given.
 *
 * Upward search stops at the filesystem root. It exists so that running the
 * tool from a subdirectory of a monorepo picks up the repository's config, the
 * same way test runners and formatters behave — consistent results regardless
 * of which directory the command was typed in.
 */
export async function loadConfig(
  startDir: string,
  explicitPath?: string,
): Promise<SkillsonarConfig> {
  if (explicitPath !== undefined) {
    const path = resolve(explicitPath);
    const text = await readIfPresent(path);
    if (text === null) throw new ConfigError(path, 'config file not found');
    return parseConfig(parseJson(text, path), path);
  }

  let directory = resolve(startDir);
  for (;;) {
    const candidate = join(directory, CONFIG_FILENAME);
    const text = await readIfPresent(candidate);
    if (text !== null) return parseConfig(parseJson(text, candidate), candidate);

    const parent = dirname(directory);
    if (parent === directory) return defaultConfig();
    directory = parent;
  }
}
