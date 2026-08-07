import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Skill } from '../src/types.ts';

/** Build an in-memory skill without touching the filesystem. */
export function makeSkill(name: string, description: string, overrides: Partial<Skill> = {}): Skill {
  return {
    id: `${name}/SKILL.md`,
    name,
    description,
    path: `/virtual/${name}/SKILL.md`,
    dir: `/virtual/${name}`,
    root: '/virtual',
    frontmatter: { name, description },
    body: '',
    bodyLine: 5,
    hasFrontmatter: true,
    frontmatterErrors: [],
    raw: `---\nname: ${name}\ndescription: ${description}\n---\n`,
    ...overrides,
  };
}

export interface SkillFixture {
  readonly name: string;
  readonly description?: string;
  /** Raw file contents, overriding `description`. Used to test malformed input. */
  readonly raw?: string;
  readonly body?: string;
  /** Extra files written inside the skill directory, keyed by relative path. */
  readonly files?: Readonly<Record<string, string>>;
}

export interface TempCollection {
  readonly root: string;
  readonly skillsDir: string;
  cleanup(): Promise<void>;
}

/** Write a temporary `.claude/skills` tree and return its paths. */
export async function writeCollection(fixtures: readonly SkillFixture[]): Promise<TempCollection> {
  const root = await mkdtemp(join(tmpdir(), 'skillsonar-test-'));
  const skillsDir = join(root, '.claude', 'skills');

  for (const fixture of fixtures) {
    const dir = join(skillsDir, fixture.name);
    await mkdir(dir, { recursive: true });

    const contents = fixture.raw ?? [
      '---',
      `name: ${fixture.name}`,
      `description: ${fixture.description ?? 'A description long enough to pass the minimum length check.'}`,
      '---',
      '',
      fixture.body ?? '# Body',
      '',
    ].join('\n');

    await writeFile(join(dir, 'SKILL.md'), contents, 'utf8');

    for (const [relative, body] of Object.entries(fixture.files ?? {})) {
      const target = join(dir, relative);
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, body, 'utf8');
    }
  }

  return {
    root,
    skillsDir,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

/** A writable stream that records everything written, for CLI tests. */
export function captureStream(): NodeJS.WriteStream & { text(): string } {
  const chunks: string[] = [];

  const stream = {
    write(chunk: string): boolean {
      chunks.push(chunk);
      return true;
    },
    text(): string {
      return chunks.join('');
    },
    isTTY: false,
    columns: 100,
  };

  return stream as unknown as NodeJS.WriteStream & { text(): string };
}
