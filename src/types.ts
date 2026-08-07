import type { FrontmatterError, YamlMap } from './skills/frontmatter.ts';

/** A discovered and parsed `SKILL.md`. */
export interface Skill {
  /** Stable identifier: the file path relative to the scan root, POSIX-separated. */
  readonly id: string;
  /** The `name` field, or the containing directory name when it is missing. */
  readonly name: string;
  /** The `description` field. Empty string when absent. */
  readonly description: string;
  /** Absolute path to the `SKILL.md` file. */
  readonly path: string;
  /** Absolute path to the skill's directory. */
  readonly dir: string;
  /** The root this skill was discovered under. */
  readonly root: string;
  readonly frontmatter: YamlMap;
  /** Markdown body following the frontmatter. */
  readonly body: string;
  /** 1-based line where the body starts. */
  readonly bodyLine: number;
  /** Whether a `---` frontmatter block was present at all. */
  readonly hasFrontmatter: boolean;
  /** Problems encountered while parsing the frontmatter block. */
  readonly frontmatterErrors: readonly FrontmatterError[];
  /** Raw file contents, retained for byte-accurate token budgeting. */
  readonly raw: string;
}

export type Severity = 'error' | 'warning' | 'info';

/** A single finding, in the shape reporters and SARIF both consume. */
export interface Diagnostic {
  /** Stable rule identifier, e.g. `SR005`. */
  readonly rule: string;
  readonly severity: Severity;
  readonly message: string;
  /** Absolute path of the file the finding belongs to. */
  readonly file: string;
  /** 1-based line number, when known. */
  readonly line?: number;
  /** Name of the skill the finding concerns, when applicable. */
  readonly skill?: string;
  /** Concrete, actionable remediation. */
  readonly hint?: string;
}

/** Confidence that a routing decision will hold up in a real agent. */
export type RoutingVerdict = 'confident' | 'contested' | 'ambiguous' | 'no-match';

/** One skill's score for one query, with the terms that produced it. */
export interface SkillScore {
  readonly skill: Skill;
  readonly score: number;
  /** Per-term contributions, descending by contribution. */
  readonly contributions: readonly TermContribution[];
}

export interface TermContribution {
  /** Stemmed term. */
  readonly term: string;
  /** Most representative surface form, for display. */
  readonly surface: string;
  /** This term's share of the total score. */
  readonly weight: number;
  /** How many skills in the corpus contain this term. */
  readonly documentFrequency: number;
}

export interface RoutingResult {
  readonly query: string;
  /** All skills that scored above zero, descending. */
  readonly ranked: readonly SkillScore[];
  /**
   * Relative gap between first and second place, in `[0, 1]`.
   * `1` when only one skill matched, `0` when the top two tie.
   */
  readonly margin: number;
  /**
   * Share of the query's available discriminative weight captured by the top
   * skill, in `[0, 1)`. Low coverage means nothing really matched, regardless
   * of how the ranking came out.
   */
  readonly coverage: number;
  readonly verdict: RoutingVerdict;
}
