import { readdir, readFile, lstat, realpath } from 'node:fs/promises';
import { join, resolve, relative, basename, sep } from 'node:path';
import { parseFrontmatter } from './frontmatter.ts';
import type { Skill } from '../types.ts';

/**
 * Conventional locations for agent skills across clients.
 *
 * Ordering matters only for reporting; every root is scanned. The list covers
 * the layouts in use as of the 2026 Agent Skills spec, and a plain `skills/`
 * directory catches repositories that publish skills as their primary artefact.
 */
export const CONVENTIONAL_ROOTS: readonly string[] = [
  '.claude/skills',
  '.agent/skills',
  '.codex/skills',
  '.cursor/skills',
  '.gemini/skills',
  '.opencode/skills',
  '.github/skills',
  'skills',
];

/**
 * Directories never worth walking into.
 *
 * Beyond the obvious speed win, skipping `node_modules` avoids reporting
 * collisions between a project's own skills and skills vendored inside its
 * dependencies — findings the user cannot act on.
 */
const IGNORED_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.cache', '.venv', 'venv', '__pycache__', 'vendor',
  'target', '.turbo', '.gradle', 'Pods', '.terraform',
]);

const SKILL_FILENAME = 'SKILL.md';
const DEFAULT_MAX_DEPTH = 8;

export interface DiscoveryOptions {
  /**
   * Follow symbolic links while walking. Off by default: a symlink inside an
   * untrusted skill pack can point at `/` or at a directory outside the scan
   * root, turning a scan into an unbounded traversal of the filesystem.
   */
  readonly followSymlinks?: boolean;
  /** Maximum directory depth below each root. Defaults to `8`. */
  readonly maxDepth?: number;
  /** Extra directory names to skip. */
  readonly exclude?: readonly string[];
}

export interface DiscoveryResult {
  readonly skills: readonly Skill[];
  /** Roots that were actually walked. */
  readonly roots: readonly string[];
  /** Non-fatal problems: unreadable files, case-mismatched filenames. */
  readonly warnings: readonly DiscoveryWarning[];
}

export interface DiscoveryWarning {
  readonly path: string;
  readonly message: string;
}

async function isDirectory(path: string, followSymlinks: boolean): Promise<boolean> {
  try {
    const stats = await lstat(path);
    if (stats.isDirectory()) return true;
    if (stats.isSymbolicLink() && followSymlinks) {
      const target = await realpath(path);
      return (await lstat(target)).isDirectory();
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Walk `dir` collecting `SKILL.md` paths.
 *
 * `visited` holds real paths of directories already entered. With
 * `followSymlinks` enabled a cycle is otherwise trivial to construct, and an
 * infinite walk on a scan of downloaded skills is a denial of service.
 */
async function collectSkillFiles(
  dir: string,
  depth: number,
  options: Required<Pick<DiscoveryOptions, 'followSymlinks' | 'maxDepth'>>,
  excluded: ReadonlySet<string>,
  visited: Set<string>,
  found: string[],
  warnings: DiscoveryWarning[],
): Promise<void> {
  if (depth > options.maxDepth) return;

  let real: string;
  try {
    real = options.followSymlinks ? await realpath(dir) : resolve(dir);
  } catch {
    return;
  }
  if (visited.has(real)) return;
  visited.add(real);

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    warnings.push({
      path: dir,
      message: `cannot read directory: ${error instanceof Error ? error.message : String(error)}`,
    });
    return;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);

    if (entry.isSymbolicLink() && !options.followSymlinks) continue;

    if (entry.isFile() || entry.isSymbolicLink()) {
      if (entry.name === SKILL_FILENAME) {
        found.push(full);
      } else if (entry.name.toLowerCase() === SKILL_FILENAME.toLowerCase()) {
        // Case-insensitive filesystems hide this until the skill ships to Linux.
        warnings.push({
          path: full,
          message: `filename must be exactly "${SKILL_FILENAME}"; found "${entry.name}". `
            + 'Agents on case-sensitive filesystems will not discover this skill.',
        });
      }
      continue;
    }

    if (!entry.isDirectory()) continue;
    if (excluded.has(entry.name)) continue;
    if (entry.name.startsWith('.') && !CONVENTIONAL_ROOTS.some((r) => r.startsWith(entry.name))) continue;

    await collectSkillFiles(full, depth + 1, options, excluded, visited, found, warnings);
  }
}

function toPosix(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}

async function loadSkill(
  file: string,
  root: string,
  warnings: DiscoveryWarning[],
): Promise<Skill | null> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    warnings.push({
      path: file,
      message: `cannot read file: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }

  const parsed = parseFrontmatter(raw);
  const dir = resolve(file, '..');

  const rawName = parsed.data['name'];
  // A missing or non-string name still yields a usable skill: the validator
  // reports it, and analysis continues using the directory name so the rest of
  // the corpus is not distorted by a hole.
  const name = typeof rawName === 'string' && rawName.trim() !== ''
    ? rawName.trim()
    : basename(dir);

  const rawDescription = parsed.data['description'];
  const description = typeof rawDescription === 'string' ? rawDescription.trim() : '';

  const relativePath = relative(root, file);
  const id = toPosix(relativePath === '' ? basename(file) : relativePath);

  return {
    id,
    name,
    description,
    path: file,
    dir,
    root,
    frontmatter: parsed.data,
    body: parsed.body,
    bodyLine: parsed.bodyLine,
    hasFrontmatter: parsed.present,
    frontmatterErrors: parsed.errors,
    raw,
  };
}

/**
 * Find and load every skill under the given paths.
 *
 * A path may be a directory to walk, a directory containing a `SKILL.md`, or a
 * `SKILL.md` file itself. When a path contains no skills directly, the
 * conventional roots beneath it are tried before giving up, so running
 * `skillsonar` at a repository root finds `.claude/skills` without arguments.
 *
 * Results are sorted by id, making output stable across machines and
 * filesystems — a precondition for diffing reports between CI runs.
 */
export async function discoverSkills(
  paths: readonly string[],
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const followSymlinks = options.followSymlinks ?? false;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const excluded = new Set([...IGNORED_DIRECTORIES, ...(options.exclude ?? [])]);

  const warnings: DiscoveryWarning[] = [];
  const roots: string[] = [];
  const byPath = new Map<string, Skill>();

  for (const input of paths) {
    const target = resolve(input);

    if (target.endsWith(`${sep}${SKILL_FILENAME}`) || basename(target) === SKILL_FILENAME) {
      const skill = await loadSkill(target, resolve(target, '..', '..'), warnings);
      if (skill !== null) byPath.set(skill.path, skill);
      roots.push(resolve(target, '..'));
      continue;
    }

    if (!(await isDirectory(target, followSymlinks))) {
      warnings.push({ path: target, message: 'path does not exist or is not a directory' });
      continue;
    }

    const found: string[] = [];
    await collectSkillFiles(
      target, 0, { followSymlinks, maxDepth }, excluded, new Set(), found, warnings,
    );

    roots.push(target);
    for (const file of found) {
      const skill = await loadSkill(file, target, warnings);
      if (skill !== null) byPath.set(skill.path, skill);
    }
  }

  const skills = [...byPath.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { skills, roots, warnings };
}
