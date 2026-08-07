/**
 * Argument parsing.
 *
 * Node's built-in `util.parseArgs` handles the mechanics, but not the part that
 * matters for a good CLI: telling a user who mistyped a flag what they probably
 * meant. An unrecognised option here produces a suggestion computed by edit
 * distance rather than a bare "unknown option", which is the difference between
 * a two-second fix and a trip to `--help`.
 */

export type OutputFormat = 'terminal' | 'json' | 'sarif' | 'markdown';

export interface ParsedArguments {
  readonly command: string;
  readonly positionals: readonly string[];
  readonly format: OutputFormat;
  readonly configPath?: string;
  readonly suitePath?: string;
  readonly limit?: number;
  readonly contextWindow?: number;
  readonly minSeverity: 'error' | 'warning' | 'info';
  readonly collisionSeverity: 'critical' | 'high' | 'moderate';
  readonly followSymlinks: boolean;
  readonly quiet: boolean;
  readonly help: boolean;
  readonly version: boolean;
}

export class ArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArgumentError';
  }
}

const FLAGS = [
  '--help', '--version', '--json', '--sarif', '--markdown', '--format',
  '--config', '--suite', '--limit', '--context-window', '--min-severity',
  '--collision-severity', '--follow-symlinks', '--quiet',
] as const;

const FORMATS: ReadonlySet<string> = new Set(['terminal', 'json', 'sarif', 'markdown']);
const SEVERITIES: ReadonlySet<string> = new Set(['error', 'warning', 'info']);
const COLLISION_SEVERITIES: ReadonlySet<string> = new Set(['critical', 'high', 'moderate']);

/** Levenshtein distance, bounded early once it exceeds `limit`. */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMinimum = i;

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (current[j - 1] as number) + 1,
        (previous[j] as number) + 1,
        (previous[j - 1] as number) + cost,
      );
      current.push(value);
      if (value < rowMinimum) rowMinimum = value;
    }

    if (rowMinimum > limit) return limit + 1;
    previous = current;
  }

  return previous[b.length] as number;
}

/**
 * Closest candidate within a length-aware edit distance.
 *
 * A fixed distance budget is wrong at both ends: two edits away from `--jsn`
 * reaches half the flag list, while three edits away from `sql-migrate` is
 * still unambiguously `sql-migration`. Scaling with input length keeps short
 * inputs strict and lets long ones tolerate a dropped suffix.
 */
function suggest(input: string, candidates: readonly string[]): string | null {
  const budget = Math.min(5, Math.max(2, Math.ceil(input.length / 3)));

  let best: string | null = null;
  let bestDistance = budget + 1;

  for (const candidate of candidates) {
    const distance = editDistance(input, candidate, bestDistance);
    if (distance <= budget && distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return best;
}

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith('--')) {
    throw new ArgumentError(`${flag} requires a value`);
  }
  return value;
}

function requireInteger(flag: string, value: string | undefined, min: number): number {
  const raw = requireValue(flag, value);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new ArgumentError(`${flag} must be an integer of at least ${min}, got "${raw}"`);
  }
  return parsed;
}

function requireOneOf(flag: string, value: string | undefined, allowed: ReadonlySet<string>): string {
  const raw = requireValue(flag, value);
  if (!allowed.has(raw)) {
    throw new ArgumentError(`${flag} must be one of ${[...allowed].join(', ')}, got "${raw}"`);
  }
  return raw;
}

export function parseArguments(argv: readonly string[], knownCommands: readonly string[]): ParsedArguments {
  const positionals: string[] = [];

  let command = '';
  let format: OutputFormat | null = null;
  let configPath: string | undefined;
  let suitePath: string | undefined;
  let limit: number | undefined;
  let contextWindow: number | undefined;
  let minSeverity: 'error' | 'warning' | 'info' = 'info';
  let collisionSeverity: 'critical' | 'high' | 'moderate' = 'moderate';
  let followSymlinks = false;
  let quiet = false;
  let help = false;
  let version = false;

  const setFormat = (next: OutputFormat, flag: string): void => {
    if (format !== null && format !== next) {
      throw new ArgumentError(`conflicting output formats: --${format} and ${flag}`);
    }
    format = next;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i] as string;

    if (argument === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (!argument.startsWith('-')) {
      if (command === '' && knownCommands.includes(argument)) command = argument;
      else positionals.push(argument);
      continue;
    }

    // Support --flag=value alongside --flag value.
    const equals = argument.indexOf('=');
    const flag = equals === -1 ? argument : argument.slice(0, equals);
    const inline = equals === -1 ? undefined : argument.slice(equals + 1);
    const next = (): string | undefined => {
      if (inline !== undefined) return inline;
      i += 1;
      return argv[i];
    };

    switch (flag) {
      case '-h': case '--help': help = true; break;
      case '-v': case '--version': version = true; break;
      case '-q': case '--quiet': quiet = true; break;
      case '--json': setFormat('json', '--json'); break;
      case '--sarif': setFormat('sarif', '--sarif'); break;
      case '--markdown': setFormat('markdown', '--markdown'); break;
      case '--format': setFormat(requireOneOf('--format', next(), FORMATS) as OutputFormat, '--format'); break;
      case '-c': case '--config': configPath = requireValue('--config', next()); break;
      case '-s': case '--suite': suitePath = requireValue('--suite', next()); break;
      case '--limit': limit = requireInteger('--limit', next(), 1); break;
      case '--context-window': contextWindow = requireInteger('--context-window', next(), 1000); break;
      case '--follow-symlinks': followSymlinks = true; break;
      case '--min-severity':
        minSeverity = requireOneOf('--min-severity', next(), SEVERITIES) as 'error' | 'warning' | 'info';
        break;
      case '--collision-severity':
        collisionSeverity = requireOneOf('--collision-severity', next(), COLLISION_SEVERITIES) as 'critical' | 'high' | 'moderate';
        break;
      default: {
        const suggestion = suggest(flag, FLAGS);
        throw new ArgumentError(
          suggestion === null
            ? `unknown option "${flag}". Run "skillsonar --help" for available options.`
            : `unknown option "${flag}". Did you mean "${suggestion}"?`,
        );
      }
    }
  }

  return {
    command,
    positionals,
    format: format ?? 'terminal',
    ...(configPath === undefined ? {} : { configPath }),
    ...(suitePath === undefined ? {} : { suitePath }),
    ...(limit === undefined ? {} : { limit }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    minSeverity,
    collisionSeverity,
    followSymlinks,
    quiet,
    help,
    version,
  };
}

export function suggestCommand(input: string, commands: readonly string[]): string | null {
  return suggest(input, commands);
}
