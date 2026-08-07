import { access } from 'node:fs/promises';
import { basename, resolve, isAbsolute } from 'node:path';
import { estimateTokens } from '../analysis/budget.ts';
import type { BudgetLimits } from '../config.ts';
import type { Diagnostic, Skill } from '../types.ts';

/**
 * Per-skill structural checks: everything that can be decided by looking at one
 * `SKILL.md` in isolation.
 *
 * Cross-skill routing analysis lives in `routing.ts`. The split is deliberate —
 * these checks answer "is this file valid", which has a right answer, while
 * routing checks answer "will this file win", which only has an answer relative
 * to everything else installed.
 */

/** The specification's cap on the description field. */
const MAX_DESCRIPTION_CHARACTERS = 1024;
/** The specification's cap on the name field. */
const MAX_NAME_CHARACTERS = 64;
/** Below this, a description cannot carry enough signal to route on. */
const MIN_DESCRIPTION_CHARACTERS = 40;

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Frontmatter keys recognised by at least one major client.
 *
 * Deliberately generous. SR017 is an `info` finding whose job is catching
 * typos like `descripton`, and a narrow list would instead produce noise for
 * anyone using a client-specific extension.
 */
const KNOWN_KEYS: ReadonlySet<string> = new Set([
  'name', 'description', 'license', 'allowed-tools', 'metadata', 'version',
  'author', 'homepage', 'repository', 'keywords', 'tags', 'icon', 'model',
  'compatibility', 'disable-model-invocation', 'argument-hint',
  'user-invocable', 'when-to-use', 'category',
]);

/**
 * Phrasings that frame a description as a trigger condition rather than a
 * capability blurb. Guidance across every major client converges on this:
 * "use when the user is doing X" routes more reliably than "does X", because
 * the agent is answering a when-question, not a what-question.
 */
const INTENT_PATTERNS: readonly RegExp[] = [
  /\buse\s+(?:this|when|for|if)\b/i,
  /\bwhen\s+(?:the\s+)?(?:user|you|a|an|working|building|writing|asked|someone)\b/i,
  /\bif\s+(?:the\s+)?(?:user|you)\b/i,
  /\bfor\s+(?:tasks|requests|questions|work|any)\b/i,
  /\bapplies\s+(?:to|when)\b/i,
  /\btrigger(?:s|ed)?\s+(?:on|when)\b/i,
  /\binvoke\s+(?:this|when)\b/i,
  /\breach\s+for\s+this\b/i,
];

/**
 * Local paths referenced from the body.
 *
 * Three shapes are recognised: Markdown links, and backticked or bare paths
 * pointing into the conventional bundled-resource directories. Restricting the
 * bare-path forms to `scripts/`, `references/` and `assets/` keeps the check
 * from firing on prose that happens to contain a slash.
 */
const MARKDOWN_LINK = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const BUNDLED_PATH = /`((?:\.\/)?(?:scripts|references|assets)\/[A-Za-z0-9._\-/]+)`/g;
const BARE_BUNDLED_PATH = /(?:^|\s)((?:\.\/)?(?:scripts|references|assets)\/[A-Za-z0-9._\-]+(?:\/[A-Za-z0-9._\-]+)*)(?=[\s.,;:)]|$)/gm;

function isExternalReference(target: string): boolean {
  if (target.startsWith('#')) return true;
  if (isAbsolute(target)) return true;
  return /^[a-z][a-z0-9+.-]*:/i.test(target);
}

/** Locate the 1-based line of the first occurrence of `needle`. */
function lineOf(source: string, needle: string, fallback: number): number {
  const index = source.indexOf(needle);
  if (index === -1) return fallback;
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source[i] === '\n') line += 1;
  }
  return line;
}

function frontmatterLine(skill: Skill, key: string): number {
  const block = skill.raw.slice(0, skill.raw.indexOf('\n---', 3) + 1);
  const match = new RegExp(`^\\s*${key}\\s*:`, 'm').exec(block);
  if (match === null) return 1;
  return lineOf(skill.raw, match[0], 1);
}

function collectReferences(body: string): Map<string, number> {
  const references = new Map<string, number>();

  const record = (target: string, offset: number): void => {
    if (target === '' || isExternalReference(target)) return;
    const clean = target.split('#')[0]?.split('?')[0] ?? '';
    if (clean === '') return;
    if (!references.has(clean)) references.set(clean, offset);
  };

  for (const match of body.matchAll(MARKDOWN_LINK)) record(match[1] ?? '', match.index);
  for (const match of body.matchAll(BUNDLED_PATH)) record(match[1] ?? '', match.index);
  for (const match of body.matchAll(BARE_BUNDLED_PATH)) record(match[1] ?? '', match.index);

  return references;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function countLinesBefore(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

export interface StructureOptions {
  readonly budget: BudgetLimits;
  /**
   * Resolve bundled file references against the filesystem. Disabled in tests
   * that construct skills from strings without a backing directory.
   */
  readonly checkReferences?: boolean;
}

/** Run every single-skill check and return the findings. */
export async function checkStructure(skill: Skill, options: StructureOptions): Promise<Diagnostic[]> {
  const found: Diagnostic[] = [];
  const at = (rule: string, severity: Diagnostic['severity'], message: string, line?: number, hint?: string): void => {
    found.push({
      rule,
      severity,
      message,
      file: skill.path,
      skill: skill.name,
      ...(line === undefined ? {} : { line }),
      ...(hint === undefined ? {} : { hint }),
    });
  };

  if (!skill.hasFrontmatter) {
    at('SR001', 'error', 'no YAML frontmatter found', 1,
      'Add a "---" delimited block at the very top of the file containing at least "name" and "description".');
    return found;
  }

  for (const error of skill.frontmatterErrors) {
    at('SR002', 'error', `frontmatter: ${error.message}`, error.line,
      'Fix the YAML so the block parses; clients that fail to parse frontmatter skip the skill entirely.');
  }

  const rawName = skill.frontmatter['name'];
  if (rawName === undefined || rawName === null || rawName === '') {
    at('SR003', 'error', 'frontmatter is missing the "name" field', 1,
      `Add "name: ${basename(skill.dir)}" to the frontmatter.`);
  } else if (typeof rawName !== 'string') {
    at('SR003', 'error', `"name" must be a string, got ${typeof rawName}`, frontmatterLine(skill, 'name'),
      'Quote the value if it looks like a number or boolean, e.g. name: "2fa-setup".');
  } else {
    const name = rawName.trim();
    if (!NAME_PATTERN.test(name)) {
      at('SR004', 'error', `name "${name}" is not lowercase-hyphenated`, frontmatterLine(skill, 'name'),
        'Use only lowercase letters, digits and single hyphens, e.g. "pdf-form-filler".');
    }
    if (name.length > MAX_NAME_CHARACTERS) {
      at('SR004', 'error',
        `name is ${name.length} characters, exceeding the ${MAX_NAME_CHARACTERS}-character limit`,
        frontmatterLine(skill, 'name'), 'Shorten the name; detail belongs in the description.');
    }
    const directory = basename(skill.dir);
    if (name !== directory) {
      at('SR005', 'warning', `name "${name}" does not match its directory "${directory}"`,
        frontmatterLine(skill, 'name'),
        `Rename the directory to "${name}", or change the name field to "${directory}".`);
    }
  }

  const rawDescription = skill.frontmatter['description'];
  if (rawDescription === undefined || rawDescription === null || rawDescription === '') {
    at('SR006', 'error', 'frontmatter is missing the "description" field', 1,
      'Add a description stating when an agent should reach for this skill. Without it the skill can never be selected.');
  } else if (typeof rawDescription !== 'string') {
    at('SR006', 'error', `"description" must be a string, got ${typeof rawDescription}`,
      frontmatterLine(skill, 'description'), 'Quote the value or use a ">" block scalar for multi-line text.');
  } else {
    const description = rawDescription.trim();
    const line = frontmatterLine(skill, 'description');

    if (description.length > MAX_DESCRIPTION_CHARACTERS) {
      at('SR007', 'error',
        `description is ${description.length} characters, exceeding the ${MAX_DESCRIPTION_CHARACTERS}-character limit`,
        line, `Remove ${description.length - MAX_DESCRIPTION_CHARACTERS} characters. Move detail into the body, which is only loaded when the skill fires.`);
    } else if (description.length < MIN_DESCRIPTION_CHARACTERS) {
      at('SR008', 'warning',
        `description is only ${description.length} characters`, line,
        'State the concrete trigger conditions and the domain terms a user would actually type. Short descriptions lose to longer neighbours.');
    }

    if (description.length >= MIN_DESCRIPTION_CHARACTERS
      && !INTENT_PATTERNS.some((pattern) => pattern.test(description))) {
      at('SR009', 'info', 'description reads as a capability blurb rather than a trigger condition', line,
        'Lead with when to act: "Use when the user ..." routes more reliably than "Handles ...".');
    }
  }

  for (const key of Object.keys(skill.frontmatter)) {
    if (!KNOWN_KEYS.has(key)) {
      at('SR017', 'info', `unrecognised frontmatter key "${key}"`, frontmatterLine(skill, key),
        'Clients ignore unknown keys silently. Move custom fields under "metadata", or check for a typo.');
    }
  }

  const descriptionTokens = estimateTokens(skill.description) + estimateTokens(skill.name) + 6;
  if (descriptionTokens > options.budget.maxSkillResidentTokens) {
    at('SR014', 'warning',
      `resident cost is about ${descriptionTokens} tokens, above the ${options.budget.maxSkillResidentTokens}-token limit`,
      frontmatterLine(skill, 'description'),
      'Name and description load on every request whether or not the skill fires. Trim the description and move detail into the body.');
  }

  const bodyTokens = estimateTokens(skill.body);
  if (bodyTokens > options.budget.maxBodyTokens) {
    at('SR016', 'info',
      `body is about ${bodyTokens} tokens, above the ${options.budget.maxBodyTokens}-token guidance`,
      skill.bodyLine,
      'Split the body into files under references/ and link to them, so the agent loads only the section it needs.');
  }

  if (options.checkReferences !== false) {
    for (const [target, offset] of collectReferences(skill.body)) {
      const resolved = resolve(skill.dir, target);
      if (await exists(resolved)) continue;
      at('SR015', 'error', `referenced file not found: ${target}`,
        skill.bodyLine + countLinesBefore(skill.body, offset) - 1,
        `Create "${target}" relative to the skill directory, or remove the reference. The agent will fail when it tries to follow this link.`);
    }
  }

  return found;
}

/** Report skills that share a `name`, which shadow each other at load time. */
export function checkDuplicateNames(skills: readonly Skill[]): Diagnostic[] {
  const byName = new Map<string, Skill[]>();

  for (const skill of skills) {
    const key = skill.name.toLowerCase();
    const bucket = byName.get(key);
    if (bucket === undefined) byName.set(key, [skill]);
    else bucket.push(skill);
  }

  const found: Diagnostic[] = [];
  for (const [name, group] of byName) {
    if (group.length < 2) continue;

    for (const skill of group) {
      const others = group.filter((entry) => entry.path !== skill.path).map((entry) => entry.id);
      found.push({
        rule: 'SR010',
        severity: 'error',
        message: `skill name "${name}" is also used by ${others.join(', ')}`,
        file: skill.path,
        skill: skill.name,
        line: 1,
        hint: 'Give each skill a unique name. Which one an agent loads currently depends on discovery order, which varies by client and filesystem.',
      });
    }
  }

  return found;
}
