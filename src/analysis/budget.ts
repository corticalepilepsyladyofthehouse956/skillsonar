import type { Skill } from '../types.ts';

/**
 * Context-budget accounting for a skill collection.
 *
 * Progressive disclosure splits a skill's cost in two, and the halves behave
 * completely differently:
 *
 * - **Resident cost** — name and description. Loaded for every installed skill,
 *   on every single request, whether or not the skill is ever used. This is the
 *   number that scales with collection size and quietly consumes the context
 *   window before the user has typed anything.
 *
 * - **Deferred cost** — the Markdown body. Paid only when the skill actually
 *   fires. A long body is not a problem; a long *description* is, because
 *   everyone pays for it forever.
 *
 * Reporting a single "skill size" number would obscure exactly the distinction
 * that matters, which is why the two are tracked separately throughout.
 */

/**
 * Estimate the token count of a string without shipping a tokenizer.
 *
 * Bundling a real BPE vocabulary would add megabytes and, worse, would be
 * wrong for every model whose vocabulary differs from the one bundled. This
 * heuristic models how byte-pair encoding actually behaves — short frequent
 * words become one token, long or unusual words split into pieces of roughly
 * four characters, punctuation is cheap, and non-Latin scripts are expensive —
 * and lands within about 10–15% of real tokenizers on English prose.
 *
 * That error bar is stated everywhere the number is displayed. It is also
 * mostly irrelevant to the tool's purpose: the error is systematic, so
 * *comparisons* between skills, and totals as a share of a context window, are
 * considerably more accurate than the absolute figures.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;

  let tokens = 0;
  let index = 0;

  while (index < text.length) {
    const char = text[index] as string;
    const code = char.codePointAt(0) ?? 0;

    // Whitespace merges into the following token rather than costing its own,
    // except newlines, which BPE vocabularies emit separately.
    if (char === '\n') {
      tokens += 1;
      index += 1;
      continue;
    }
    if (char === ' ' || char === '\t' || char === '\r') {
      index += 1;
      continue;
    }

    // Latin letters and digits: accumulate the whole word, then split it the
    // way BPE would.
    //
    // The threshold is six rather than four because BPE vocabularies contain
    // whole-word merges for essentially every common English word, and those
    // run to six or seven characters — "should", "before", "because" are each
    // a single token. Only past that length does a word start fragmenting, and
    // then into pieces of roughly four characters. An earlier version split at
    // four and overestimated ordinary prose by about 25%.
    if (/[A-Za-z0-9']/.test(char)) {
      let end = index;
      while (end < text.length && /[A-Za-z0-9']/.test(text[end] as string)) end += 1;
      const length = end - index;
      tokens += length <= 6 ? 1 : 1 + Math.ceil((length - 6) / 4);
      index = end;
      continue;
    }

    // Characters outside the Latin range are far less likely to be covered by a
    // multi-character merge, so they cost close to one token each.
    if (code > 0x2000) {
      tokens += 1;
      index += 1;
      continue;
    }

    // Punctuation runs partially merge: "),." is usually fewer than three tokens.
    let end = index;
    while (end < text.length && !/[A-Za-z0-9'\s]/.test(text[end] as string) && (text.codePointAt(end) ?? 0) <= 0x2000) {
      end += 1;
    }
    tokens += Math.max(1, Math.ceil((end - index) / 2));
    index = end;
  }

  return tokens;
}

/**
 * Structural overhead the agent adds when presenting a skill in its system
 * prompt: the delimiters, field labels and separators around the name and
 * description. The exact framing varies by client, so this is a flat, modest
 * allowance rather than a false precision.
 */
const PRESENTATION_OVERHEAD_TOKENS = 6;

export interface SkillBudget {
  readonly skill: Skill;
  readonly nameTokens: number;
  readonly descriptionTokens: number;
  /** Name + description + presentation overhead. Paid on every request. */
  readonly residentTokens: number;
  /** Body cost, paid only when the skill fires. */
  readonly deferredTokens: number;
  readonly descriptionCharacters: number;
}

export interface BudgetReport {
  readonly skills: readonly SkillBudget[];
  /** Sum of resident cost across the collection. */
  readonly totalResidentTokens: number;
  readonly totalDeferredTokens: number;
  /** Resident cost as a fraction of `contextWindow`. */
  readonly residentShare: number;
  readonly contextWindow: number;
  /** Skills sorted by resident cost, most expensive first. */
  readonly heaviest: readonly SkillBudget[];
}

export interface BudgetOptions {
  /**
   * Context window to measure the resident share against. Defaults to 200,000,
   * the common window for current long-context coding models.
   */
  readonly contextWindow?: number;
}

export function analyseBudget(skills: readonly Skill[], options: BudgetOptions = {}): BudgetReport {
  const contextWindow = options.contextWindow ?? 200_000;

  const entries: SkillBudget[] = skills.map((skill) => {
    const nameTokens = estimateTokens(skill.name);
    const descriptionTokens = estimateTokens(skill.description);
    return {
      skill,
      nameTokens,
      descriptionTokens,
      residentTokens: nameTokens + descriptionTokens + PRESENTATION_OVERHEAD_TOKENS,
      deferredTokens: estimateTokens(skill.body),
      descriptionCharacters: skill.description.length,
    };
  });

  const totalResidentTokens = entries.reduce((sum, entry) => sum + entry.residentTokens, 0);
  const totalDeferredTokens = entries.reduce((sum, entry) => sum + entry.deferredTokens, 0);

  const heaviest = [...entries].sort(
    (a, b) => (b.residentTokens - a.residentTokens) || a.skill.id.localeCompare(b.skill.id),
  );

  return {
    skills: entries,
    totalResidentTokens,
    totalDeferredTokens,
    residentShare: contextWindow === 0 ? 0 : totalResidentTokens / contextWindow,
    contextWindow,
    heaviest,
  };
}
