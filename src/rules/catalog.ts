import type { Severity } from '../types.ts';

/**
 * The rule catalogue.
 *
 * Every finding the tool can emit is registered here with a stable identifier,
 * a default severity, and a one-line rationale. Stable ids matter more than
 * they might appear: they are what lets a team disable a rule in config, what
 * appears in SARIF and therefore in GitHub's code-scanning UI, and what makes a
 * finding searchable when someone hits it at three in the morning.
 *
 * Severities follow one principle. `error` is reserved for defects that make a
 * skill unusable or unroutable — things that are broken, not merely
 * suboptimal. Style, cost and quality signals are `warning` or `info`, so that
 * a default CI gate blocks on real breakage and nothing else. A linter that
 * fails builds over opinions gets disabled.
 */

export interface RuleDefinition {
  readonly id: string;
  readonly title: string;
  readonly severity: Severity;
  /** Why this rule exists, in one sentence. */
  readonly rationale: string;
}

export const RULES = {
  SR001: {
    id: 'SR001',
    title: 'missing-frontmatter',
    severity: 'error',
    rationale: 'A skill without YAML frontmatter has no name or description, so no agent can discover it.',
  },
  SR002: {
    id: 'SR002',
    title: 'invalid-frontmatter',
    severity: 'error',
    rationale: 'Malformed frontmatter is parsed inconsistently across clients, or not at all.',
  },
  SR003: {
    id: 'SR003',
    title: 'missing-name',
    severity: 'error',
    rationale: 'The name field identifies the skill; without it the skill cannot be referenced or invoked.',
  },
  SR004: {
    id: 'SR004',
    title: 'invalid-name',
    severity: 'error',
    rationale: 'Names outside lowercase-hyphenated form break directory conventions and cross-client lookup.',
  },
  SR005: {
    id: 'SR005',
    title: 'name-directory-mismatch',
    severity: 'warning',
    rationale: 'Clients that resolve skills by directory will load a different skill than the name suggests.',
  },
  SR006: {
    id: 'SR006',
    title: 'missing-description',
    severity: 'error',
    rationale: 'The description is the only text an agent sees when deciding to load a skill; without it the skill never fires.',
  },
  SR007: {
    id: 'SR007',
    title: 'description-too-long',
    severity: 'error',
    rationale: 'The specification caps descriptions at 1024 characters; longer descriptions are rejected or truncated.',
  },
  SR008: {
    id: 'SR008',
    title: 'description-too-thin',
    severity: 'warning',
    rationale: 'A very short description carries too little signal to distinguish the skill from its neighbours.',
  },
  SR009: {
    id: 'SR009',
    title: 'description-not-intent-framed',
    severity: 'info',
    rationale: 'Descriptions phrased as capabilities rather than trigger conditions route less reliably than those that state when to act.',
  },
  SR010: {
    id: 'SR010',
    title: 'duplicate-name',
    severity: 'error',
    rationale: 'Two skills sharing a name shadow each other; which one loads depends on discovery order.',
  },
  SR011: {
    id: 'SR011',
    title: 'routing-collision',
    severity: 'warning',
    rationale: 'Two skills respond near-identically to the same queries, so selection between them is effectively arbitrary.',
  },
  SR012: {
    id: 'SR012',
    title: 'signature-stolen',
    severity: 'error',
    rationale: 'The skill loses a query built from its own most distinctive terms, so no phrasing of its purpose routes to it.',
  },
  SR013: {
    id: 'SR013',
    title: 'weak-routing-signal',
    severity: 'warning',
    rationale: 'Every term in the skill is shared across most of the collection, leaving nothing for a router to select on.',
  },
  SR014: {
    id: 'SR014',
    title: 'resident-budget-exceeded',
    severity: 'warning',
    rationale: 'Name and description are loaded on every request, so an oversized description is a permanent context tax.',
  },
  SR015: {
    id: 'SR015',
    title: 'broken-reference',
    severity: 'error',
    rationale: 'A skill body referencing a missing bundled file fails at the moment the agent tries to follow it.',
  },
  SR016: {
    id: 'SR016',
    title: 'body-too-long',
    severity: 'info',
    rationale: 'Bodies beyond the recommended length are more reliably split into referenced files than read whole.',
  },
  SR017: {
    id: 'SR017',
    title: 'unknown-frontmatter-key',
    severity: 'info',
    rationale: 'Unrecognised keys are usually typos of real fields and are silently ignored by clients.',
  },
} as const satisfies Record<string, RuleDefinition>;

export type RuleId = keyof typeof RULES;

export const RULE_IDS: readonly RuleId[] = Object.keys(RULES) as RuleId[];

export function ruleOf(id: RuleId): RuleDefinition {
  return RULES[id];
}
