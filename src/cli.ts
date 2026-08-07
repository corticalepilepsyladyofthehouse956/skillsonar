#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseArguments, suggestCommand, ArgumentError, type ParsedArguments } from './cli/args.ts';
import { analyze, countDiagnostics } from './analyze.ts';
import { loadConfig, ConfigError, CONFIG_FILENAME, type SkillsonarConfig } from './config.ts';
import { route, signatureTerms } from './analysis/router.ts';
import { loadSuite, runSuite } from './testing/suite.ts';
import { RULES, RULE_IDS } from './rules/catalog.ts';
import {
  renderScan, renderRoute, renderExplain, renderBudget, renderTestResults, terminalOptions,
} from './report/terminal.ts';
import { scanToJson, routeToJson, testsToJson } from './report/json.ts';
import { scanToSarif } from './report/sarif.ts';
import { scanToMarkdown, testsToMarkdown } from './report/markdown.ts';
import { createStyler } from './report/style.ts';
import type { Severity } from './types.ts';

/**
 * Exit codes are part of the contract, because the primary consumer is CI.
 *
 * The distinction between 1 and 2 is what lets a workflow tell "the tool found
 * problems in your skills" from "the tool was invoked wrongly". Collapsing them
 * would make a typo in a workflow file look like a failing check.
 */
const EXIT = {
  ok: 0,
  findings: 1,
  usage: 2,
  internal: 3,
} as const;

const COMMANDS = ['scan', 'route', 'explain', 'collide', 'budget', 'test', 'rules', 'init'] as const;

const HELP = `
  skillsonar — static routing analysis for AI agent skills

  Agent skills are selected by their name and description alone. When two
  descriptions overlap, selection between them becomes arbitrary — and no
  amount of improving the skill body fixes it. skillsonar finds those
  collisions deterministically, offline, in milliseconds.

  USAGE
    skillsonar <command> [paths...] [options]

  COMMANDS
    scan [paths...]            Full analysis: validation, collisions, budget  (default)
    route <query> [paths...]   Rank every skill against a query, with scores and margin
    explain <skill> [paths...] Show which terms give a skill its routing power
    collide [paths...]         List colliding skill pairs only
    budget [paths...]          Context cost of the collection
    test [paths...]            Run routing regression tests
    rules                      List every rule and its default severity
    init [dir]                 Write a starter config and test suite

  OPTIONS
    -c, --config <file>        Config file (default: nearest ${CONFIG_FILENAME})
    -s, --suite <file>         Test suite for "test" (default: skillsonar.tests.yaml)
        --json                 Machine-readable JSON
        --sarif                SARIF 2.1.0, for GitHub code scanning
        --markdown             Markdown, sized for a pull-request comment
        --format <fmt>         terminal | json | sarif | markdown
        --min-severity <sev>   Exit non-zero at this level or worse (default: error)
        --collision-severity <sev>
                               Report collisions at this level or worse:
                               critical | high | moderate (default: moderate)
        --context-window <n>   Window size for budget share (default: 200000)
        --limit <n>            Cap ranked results
        --follow-symlinks      Follow symlinks while scanning (off by default)
    -q, --quiet                Findings only, no summary sections
    -h, --help                 This message
    -v, --version              Version

  EXAMPLES
    skillsonar                                      Scan the current directory
    skillsonar scan .claude/skills
    skillsonar route "extract tables from this invoice"
    skillsonar explain pdf-tools
    skillsonar test --suite skillsonar.tests.yaml
    skillsonar scan --sarif > results.sarif

  EXIT CODES
    0  clean            1  findings or failing tests
    2  usage error      3  internal error

  Deterministic and offline. It measures whether descriptions carry enough
  signal to distinguish skills; it does not predict a specific model's choice.
  Full documentation: https://github.com/hamodywe/skillsonar
`;

const STARTER_SUITE = `# skillsonar routing tests
#
# Each case asserts which skill should win a query. Run with:
#   skillsonar test
#
# These are deterministic lexical checks, not model evals. They catch the
# regression that matters most in practice: editing one description silently
# changing which skill wins for an unrelated query.

tests:
  - query: replace with a realistic user request
    expect: the-skill-that-should-win
    # minMargin: 0.25   # require a 25% lead over second place
    # avoid: [a-skill-that-must-not-win]
    # note: why this case exists

  - query: a request that should not match any skill
    expect: none
`;

const STARTER_CONFIG = `{
  "rules": {
    "SR009": "info"
  },
  "budget": {
    "contextWindow": 200000,
    "maxSkillResidentTokens": 260
  }
}
`;

interface Streams {
  readonly out: NodeJS.WriteStream;
  readonly err: NodeJS.WriteStream;
}

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

function pathsFrom(positionals: readonly string[], skip = 0): string[] {
  const paths = positionals.slice(skip);
  return paths.length > 0 ? paths : ['.'];
}

/**
 * Merge command-line overrides into the loaded config.
 *
 * Flags win over the file, which is the ordering every developer expects: the
 * config is the project's standing decision, the flag is this invocation's
 * exception.
 */
function applyOverrides(config: SkillsonarConfig, args: ParsedArguments): SkillsonarConfig {
  return {
    ...config,
    followSymlinks: args.followSymlinks || config.followSymlinks,
    budget: args.contextWindow === undefined
      ? config.budget
      : { ...config.budget, contextWindow: args.contextWindow },
  };
}

async function readVersion(): Promise<string> {
  // Resolves from both `src/cli.ts` during development and `dist/cli.js` once
  // built, since package.json sits one level above each.
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, '..', 'package.json'), join(here, '..', '..', 'package.json')]) {
    try {
      const parsed: unknown = JSON.parse(await readFile(candidate, 'utf8'));
      if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
        const version = (parsed as { version: unknown }).version;
        if (typeof version === 'string') return version;
      }
    } catch {
      continue;
    }
  }
  return '0.0.0';
}

function exitCodeFor(diagnostics: readonly { severity: Severity }[], minimum: Severity): number {
  const threshold = SEVERITY_RANK[minimum];
  return diagnostics.some((entry) => SEVERITY_RANK[entry.severity] <= threshold)
    ? EXIT.findings
    : EXIT.ok;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function commandScan(args: ParsedArguments, config: SkillsonarConfig, streams: Streams): Promise<number> {
  const paths = pathsFrom(args.positionals);
  const result = await analyze(paths, config, { minimumCollisionSeverity: args.collisionSeverity });

  switch (args.format) {
    case 'json':
      streams.out.write(scanToJson(result));
      break;
    case 'sarif':
      streams.out.write(scanToSarif(result, process.cwd(), await readVersion()));
      break;
    case 'markdown':
      streams.out.write(scanToMarkdown(result));
      break;
    default:
      streams.out.write(renderScan(result, terminalOptions(streams.out)));
  }

  return exitCodeFor(result.diagnostics, args.minSeverity === 'info' ? 'error' : args.minSeverity);
}

async function commandRoute(args: ParsedArguments, config: SkillsonarConfig, streams: Streams): Promise<number> {
  const query = args.positionals[0];
  if (query === undefined || query.trim() === '') {
    throw new ArgumentError('route requires a query, e.g. skillsonar route "extract tables from a PDF"');
  }

  const result = await analyze(pathsFrom(args.positionals, 1), config, { skipReferenceChecks: true });
  if (result.skills.length === 0) {
    streams.err.write('No skills found to route against.\n');
    return EXIT.findings;
  }

  const routed = route(result.corpus, query, {
    scoring: config.scoring,
    thresholds: config.thresholds,
    ...(args.limit === undefined ? {} : { limit: args.limit }),
  });

  if (args.format === 'json') streams.out.write(routeToJson(routed, result.corpus));
  else streams.out.write(renderRoute(routed, result.corpus, terminalOptions(streams.out)));

  return EXIT.ok;
}

async function commandExplain(args: ParsedArguments, config: SkillsonarConfig, streams: Streams): Promise<number> {
  const name = args.positionals[0];
  if (name === undefined) {
    throw new ArgumentError('explain requires a skill name, e.g. skillsonar explain pdf-tools');
  }

  const result = await analyze(pathsFrom(args.positionals, 1), config, { skipReferenceChecks: true });
  const document = result.corpus.documents.find((entry) => entry.skill.name === name);

  if (document === undefined) {
    const available = result.corpus.documents.map((entry) => entry.skill.name);
    const suggestion = suggestCommand(name, available);
    streams.err.write(
      suggestion === null
        ? `No skill named "${name}". Found: ${available.join(', ') || 'nothing'}\n`
        : `No skill named "${name}". Did you mean "${suggestion}"?\n`,
    );
    return EXIT.usage;
  }

  const signature = signatureTerms(document, result.corpus, args.limit ?? 15);

  if (args.format === 'json') {
    streams.out.write(`${JSON.stringify({
      skill: document.skill.name,
      description: document.skill.description,
      corpusSize: result.corpus.size,
      terms: signature.map((term) => ({
        term: term.surface,
        weight: Number(term.weight.toFixed(4)),
        documentFrequency: term.documentFrequency,
      })),
    }, null, 2)}\n`);
  } else {
    streams.out.write(renderExplain(document, signature, result.corpus, terminalOptions(streams.out)));
  }

  return EXIT.ok;
}

async function commandCollide(args: ParsedArguments, config: SkillsonarConfig, streams: Streams): Promise<number> {
  const result = await analyze(pathsFrom(args.positionals), config, {
    skipReferenceChecks: true,
    minimumCollisionSeverity: args.collisionSeverity,
  });

  const collisionFindings = result.diagnostics.filter(
    (diagnostic) => diagnostic.rule === 'SR011' || diagnostic.rule === 'SR012' || diagnostic.rule === 'SR013',
  );

  if (args.format === 'json') {
    streams.out.write(scanToJson({ ...result, diagnostics: collisionFindings }));
  } else {
    streams.out.write(renderScan({ ...result, diagnostics: collisionFindings }, terminalOptions(streams.out)));
  }

  return exitCodeFor(collisionFindings, args.minSeverity === 'info' ? 'error' : args.minSeverity);
}

async function commandBudget(args: ParsedArguments, config: SkillsonarConfig, streams: Streams): Promise<number> {
  const result = await analyze(pathsFrom(args.positionals), config, { skipReferenceChecks: true });

  if (args.format === 'json') {
    streams.out.write(scanToJson({ ...result, diagnostics: [] }));
  } else {
    streams.out.write(renderBudget(result.budget, terminalOptions(streams.out)));
  }

  return EXIT.ok;
}

const DEFAULT_SUITE_NAMES = ['skillsonar.tests.yaml', 'skillsonar.tests.yml', 'skillsonar.tests.json'];

async function resolveSuitePath(explicit: string | undefined, cwd: string): Promise<string | null> {
  if (explicit !== undefined) return resolve(explicit);

  for (const name of DEFAULT_SUITE_NAMES) {
    const candidate = join(cwd, name);
    try {
      await readFile(candidate, 'utf8');
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

async function commandTest(args: ParsedArguments, config: SkillsonarConfig, streams: Streams): Promise<number> {
  const suitePath = await resolveSuitePath(args.suitePath, process.cwd());
  if (suitePath === null) {
    streams.err.write(
      `No routing test suite found. Looked for ${DEFAULT_SUITE_NAMES.join(', ')} in the current directory.\n`
      + 'Create one with "skillsonar init", or point at a file with --suite.\n',
    );
    return EXIT.usage;
  }

  const suite = await loadSuite(suitePath);
  if (suite.errors.length > 0) {
    for (const error of suite.errors) {
      streams.err.write(`${suitePath}:${error.line}  ${error.message}\n`);
    }
    return EXIT.usage;
  }
  if (suite.cases.length === 0) {
    streams.err.write(`${suitePath} contains no test cases.\n`);
    return EXIT.usage;
  }

  const result = await analyze(pathsFrom(args.positionals), config, { skipReferenceChecks: true });
  const run = runSuite(suite, result.corpus, config);

  switch (args.format) {
    case 'json': streams.out.write(testsToJson(run, suitePath)); break;
    case 'markdown': streams.out.write(testsToMarkdown(run)); break;
    default: streams.out.write(renderTestResults(run, terminalOptions(streams.out)));
  }

  return run.failed > 0 ? EXIT.findings : EXIT.ok;
}

function commandRules(args: ParsedArguments, streams: Streams): number {
  if (args.format === 'json') {
    streams.out.write(`${JSON.stringify(
      RULE_IDS.map((id) => ({
        id, title: RULES[id].title, severity: RULES[id].severity, rationale: RULES[id].rationale,
      })),
      null, 2,
    )}\n`);
    return EXIT.ok;
  }

  const styler = createStyler(streams.out);
  const colour = { error: 'red', warning: 'yellow', info: 'grey' } as const;

  streams.out.write(`\n  ${styler('bold', 'skillsonar rules')}\n\n`);
  for (const id of RULE_IDS) {
    const rule = RULES[id];
    streams.out.write(
      `  ${styler('bold', rule.id)}  ${styler(colour[rule.severity], rule.severity.padEnd(7))} `
      + `${rule.title}\n        ${styler('grey', rule.rationale)}\n\n`,
    );
  }
  streams.out.write(
    `  ${styler('grey', `Set any rule to "error", "warning", "info" or "off" in ${CONFIG_FILENAME}.`)}\n\n`,
  );

  return EXIT.ok;
}

async function commandInit(args: ParsedArguments, streams: Streams): Promise<number> {
  const target = resolve(args.positionals[0] ?? '.');
  await mkdir(target, { recursive: true });

  const written: string[] = [];
  const skipped: string[] = [];

  for (const [name, contents] of [
    [CONFIG_FILENAME, STARTER_CONFIG],
    ['skillsonar.tests.yaml', STARTER_SUITE],
  ] as const) {
    const path = join(target, name);
    try {
      // `wx` fails when the file exists, so an existing config is never
      // silently replaced — losing a tuned configuration to a stray `init`
      // would be a genuinely destructive default.
      await writeFile(path, contents, { flag: 'wx' });
      written.push(name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') skipped.push(name);
      else throw error;
    }
  }

  const styler = createStyler(streams.out);
  for (const name of written) streams.out.write(`  ${styler('green', 'created')}  ${name}\n`);
  for (const name of skipped) streams.out.write(`  ${styler('grey', 'exists ')}  ${name}\n`);
  streams.out.write(`\n  Edit skillsonar.tests.yaml, then run ${styler('bold', 'skillsonar test')}.\n\n`);

  return EXIT.ok;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function run(argv: readonly string[], streams: Streams): Promise<number> {
  let args: ParsedArguments;

  try {
    args = parseArguments(argv, COMMANDS);
  } catch (error) {
    if (error instanceof ArgumentError) {
      streams.err.write(`skillsonar: ${error.message}\n`);
      return EXIT.usage;
    }
    throw error;
  }

  if (args.help) {
    streams.out.write(`${HELP}\n`);
    return EXIT.ok;
  }
  if (args.version) {
    streams.out.write(`${await readVersion()}\n`);
    return EXIT.ok;
  }

  // A bare first positional that is not a known command is almost always a
  // mistyped command rather than a path, unless it looks like a path.
  const first = args.positionals[0];
  if (args.command === '' && first !== undefined && !/[./\\]/.test(first)) {
    const suggestion = suggestCommand(first, COMMANDS);
    if (suggestion !== null) {
      streams.err.write(`skillsonar: unknown command "${first}". Did you mean "${suggestion}"?\n`);
      return EXIT.usage;
    }
  }

  const command = args.command === '' ? 'scan' : args.command;

  if (command === 'rules') return commandRules(args, streams);
  if (command === 'init') return commandInit(args, streams);

  let config: SkillsonarConfig;
  try {
    config = applyOverrides(await loadConfig(process.cwd(), args.configPath), args);
  } catch (error) {
    if (error instanceof ConfigError) {
      streams.err.write(`skillsonar: ${error.path}\n  ${error.message}\n`);
      return EXIT.usage;
    }
    throw error;
  }

  // Commands validate their own positionals, so their usage errors surface
  // here rather than escaping as an unexpected internal failure.
  try {
    switch (command) {
      case 'route': return await commandRoute(args, config, streams);
      case 'explain': return await commandExplain(args, config, streams);
      case 'collide': return await commandCollide(args, config, streams);
      case 'budget': return await commandBudget(args, config, streams);
      case 'test': return await commandTest(args, config, streams);
      default: return await commandScan(args, config, streams);
    }
  } catch (error) {
    if (error instanceof ArgumentError) {
      streams.err.write(`skillsonar: ${error.message}\n`);
      return EXIT.usage;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const streams: Streams = { out: process.stdout, err: process.stderr };

  try {
    process.exitCode = await run(process.argv.slice(2), streams);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    streams.err.write(`skillsonar: unexpected error: ${message}\n`);
    if (process.env['SKILLSONAR_DEBUG'] !== undefined && error instanceof Error && error.stack !== undefined) {
      streams.err.write(`${error.stack}\n`);
    } else {
      streams.err.write('Set SKILLSONAR_DEBUG=1 for a stack trace, and please report this at\n'
        + 'https://github.com/hamodywe/skillsonar/issues\n');
    }
    process.exitCode = EXIT.internal;
  }
}

/**
 * Run only when executed directly, so tests can import `run` and drive it with
 * fake streams without the process exiting underneath them.
 *
 * Compared by resolved filesystem path rather than by URL string: on Windows a
 * URL comparison fails on drive-letter case and backslash separators, which
 * would silently turn the CLI into a no-op.
 */
const invokedPath = process.argv[1];
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
  await main();
}
