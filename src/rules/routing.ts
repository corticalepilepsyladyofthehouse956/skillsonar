import type { Collision, CollisionReport, WeakSignal } from '../analysis/collisions.ts';
import type { Diagnostic } from '../types.ts';

/**
 * Corpus-level routing checks.
 *
 * These are the findings that no single-file linter can produce, because the
 * defect does not live in any one file. A skill can be flawless on its own and
 * still be unreachable, purely because of what sits next to it.
 */

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function list(values: readonly string[], limit: number): string {
  const shown = values.slice(0, limit);
  const rest = values.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} (+${rest} more)` : shown.join(', ');
}

/**
 * Turn a collision into an actionable message.
 *
 * The remediation is the point. "These two skills are 87% similar" leaves the
 * user to work out what to change; naming the shared terms that caused it and
 * the unique terms that survived tells them exactly which words to add and
 * which to cut.
 */
function describeCollision(collision: Collision): { message: string; hint: string } {
  const shared = collision.sharedTerms
    .filter((term) => term.weight > 0.5)
    .slice(0, 5)
    .map((term) => term.surface);

  // Phrased directionally because the finding is directional: `a` is the skill
  // being shadowed, and it is the one whose description has to change.
  const message = `${percent(collision.similarity)} of its routing weight is also claimed by `
    + `"${collision.b.skill.name}"`
    + (collision.reverseSimilarity < collision.similarity - 0.15
      ? ` (only ${percent(collision.reverseSimilarity)} the other way — this skill is the one being shadowed)`
      : '');

  if (collision.uniqueToA.length === 0 && collision.uniqueToB.length === 0) {
    return {
      message,
      hint: 'These two skills have no distinguishing vocabulary at all. Either merge them, '
        + 'or rewrite one description around the terms a user would type when they want '
        + 'that skill specifically and not the other.',
    };
  }

  const overlap = shared.length > 0
    ? `Both descriptions lean on: ${list(shared, 5)}. `
    : '';

  const distinctA = collision.uniqueToA.length > 0
    ? `Only "${collision.a.skill.name}" mentions: ${list(collision.uniqueToA, 4)}. `
    : `"${collision.a.skill.name}" has no vocabulary of its own. `;

  const distinctB = collision.uniqueToB.length > 0
    ? `Only "${collision.b.skill.name}" mentions: ${list(collision.uniqueToB, 4)}.`
    : `"${collision.b.skill.name}" has no vocabulary of its own.`;

  return {
    message,
    hint: `${overlap}${distinctA}${distinctB} Lead each description with the terms unique to it, `
      + 'and state explicitly what the skill is not for.',
  };
}

export function checkCollisions(report: CollisionReport, minimum: 'critical' | 'high' | 'moderate'): Diagnostic[] {
  const order = { moderate: 0, high: 1, critical: 2 } as const;
  const floor = order[minimum];
  const found: Diagnostic[] = [];

  for (const collision of report.collisions) {
    if (order[collision.severity] < floor) continue;
    const { message, hint } = describeCollision(collision);

    // Reported against the first skill only. Emitting the mirrored finding
    // would double every count without adding information, and the hint
    // already names both sides.
    found.push({
      rule: 'SR011',
      severity: collision.severity === 'critical' ? 'error' : 'warning',
      message,
      file: collision.a.skill.path,
      skill: collision.a.skill.name,
      line: 1,
      hint,
    });
  }

  return found;
}

/**
 * Report skills that lose a query assembled from their own strongest terms.
 *
 * This is the tool's highest-confidence finding. It requires no threshold
 * interpretation: either the skill wins on its own signature vocabulary or it
 * does not, and if it does not, there is no phrasing of its own purpose that
 * routes to it ahead of the thief.
 */
export function checkStolenSignatures(report: CollisionReport): Diagnostic[] {
  const found: Diagnostic[] = [];

  for (const probe of report.stolen) {
    const winner = probe.result.ranked[0];
    const own = probe.result.ranked.find((entry) => entry.skill.id === probe.document.skill.id);

    const gap = winner !== undefined && own !== undefined && own.score > 0
      ? ` (${winner.score.toFixed(2)} vs ${own.score.toFixed(2)})`
      : '';

    found.push({
      rule: 'SR012',
      severity: 'error',
      message: `loses its own signature query to "${probe.stolenBy}"${gap}`,
      file: probe.document.skill.path,
      skill: probe.document.skill.name,
      line: 1,
      hint: `The query "${probe.probe}" was built from this skill's own most distinctive terms, `
        + `and "${probe.stolenBy}" still scored higher. Add vocabulary that only this skill owns — `
        + 'the specific format, tool, or domain it handles that the other one does not.',
    });
  }

  return found;
}

/** Report skills with no vocabulary rare enough to be selected on. */
export function checkWeakSignals(weak: readonly WeakSignal[]): Diagnostic[] {
  return weak.map((entry) => ({
    rule: 'SR013',
    severity: 'warning' as const,
    message: `no distinctive vocabulary: its rarest term appears in ${percent(entry.spread)} of the collection`,
    file: entry.document.skill.path,
    skill: entry.document.skill.name,
    line: 1,
    hint: 'Every word in this skill\'s name and description is common across the collection, so nothing '
      + 'makes it selectable. Add concrete nouns — file formats, API names, tools, domain terms — that '
      + 'no other skill uses.',
  }));
}
