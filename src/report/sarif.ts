import { relative } from 'node:path';
import { RULES, RULE_IDS, type RuleId } from '../rules/catalog.ts';
import type { AnalysisResult } from '../analyze.ts';
import type { Severity } from '../types.ts';

/**
 * SARIF 2.1.0 output.
 *
 * SARIF is what turns findings from CI log text into review-time annotations:
 * uploaded through `github/codeql-action/upload-sarif`, each diagnostic becomes
 * an inline comment on the pull request that introduced it, on the exact line.
 *
 * That changes what the tool is for. A routing collision reported in a log is
 * something a developer reads after deciding the change is fine. The same
 * collision reported on the diff is something they see while deciding.
 */

const SARIF_VERSION = '2.1.0';
const SARIF_SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';

/**
 * SARIF has no `warning`/`info` distinction problem, but it does treat `error`
 * as build-breaking in some consumers. The mapping is intentionally
 * conservative: only genuine defects are `error`, matching the rule catalogue.
 */
const SARIF_LEVEL: Record<Severity, string> = {
  error: 'error',
  warning: 'warning',
  info: 'note',
};

function toUri(path: string, cwd: string): string {
  const rel = relative(cwd, path);
  const normalised = (rel === '' || rel.startsWith('..') ? path : rel).split('\\').join('/');
  // SARIF requires URI-encoded paths, but not encoded separators.
  return normalised.split('/').map(encodeURIComponent).join('/');
}

function ruleDescriptor(id: RuleId): Record<string, unknown> {
  const rule = RULES[id];
  return {
    id: rule.id,
    name: rule.title
      .split('-')
      .map((part) => (part.length === 0 ? part : (part[0] as string).toUpperCase() + part.slice(1)))
      .join(''),
    shortDescription: { text: rule.title.split('-').join(' ') },
    fullDescription: { text: rule.rationale },
    defaultConfiguration: { level: SARIF_LEVEL[rule.severity] },
    helpUri: `https://github.com/hamodywe/skillsonar/blob/main/docs/rules.md#${rule.id.toLowerCase()}-${rule.title}`,
    help: { text: rule.rationale },
    properties: { tags: ['agent-skills', 'routing'] },
  };
}

export function scanToSarif(result: AnalysisResult, cwd = process.cwd(), version = '0.1.0'): string {
  const document = {
    $schema: SARIF_SCHEMA,
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: 'skillsonar',
            informationUri: 'https://github.com/hamodywe/skillsonar',
            version,
            semanticVersion: version,
            rules: RULE_IDS.map(ruleDescriptor),
          },
        },
        results: result.diagnostics.map((diagnostic) => ({
          ruleId: diagnostic.rule,
          level: SARIF_LEVEL[diagnostic.severity],
          message: {
            text: diagnostic.hint === undefined
              ? diagnostic.message
              : `${diagnostic.message}\n\n${diagnostic.hint}`,
          },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: toUri(diagnostic.file, cwd) },
                region: { startLine: Math.max(1, diagnostic.line ?? 1) },
              },
            },
          ],
          ...(diagnostic.skill === undefined
            ? {}
            : { properties: { skill: diagnostic.skill } }),
          // Fingerprints let GitHub track a finding across commits even when
          // the surrounding file shifts, so a collision that was dismissed
          // stays dismissed instead of reappearing on every unrelated edit.
          partialFingerprints: {
            skillsonarRuleSkill: `${diagnostic.rule}:${diagnostic.skill ?? toUri(diagnostic.file, cwd)}`,
          },
        })),
      },
    ],
  };

  return `${JSON.stringify(document, null, 2)}\n`;
}
