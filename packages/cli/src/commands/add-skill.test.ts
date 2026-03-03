import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';

import { HELP_TEXT } from '../bin';
import { runAddSkill } from './add-skill';

const createdPaths: string[] = [];

function rememberPath(pathValue: string): string {
  createdPaths.push(pathValue);
  return pathValue;
}

async function createTempRoot(): Promise<string> {
  return rememberPath(await mkdtemp(join(tmpdir(), 'vobase-add-skill-test-')));
}

const gapFreeSkillDirectory = rememberPath(
  resolve(process.cwd(), '.agents', 'skills', 'gap-free-sequences'),
);
const integerMoneySkillDirectory = rememberPath(
  resolve(process.cwd(), '.agents', 'skills', 'integer-money'),
);

describe('runAddSkill', () => {
  afterAll(async () => {
    for (const pathValue of createdPaths) {
      await rm(pathValue, { recursive: true, force: true });
    }
  });

  it('installs a skill to .agents/skills/<name>/', async () => {
    await createTempRoot();
    process.exitCode = 0;
    await rm(gapFreeSkillDirectory, { recursive: true, force: true });

    await runAddSkill(['gap-free-sequences']);

    expect(
      await Bun.file(join(gapFreeSkillDirectory, 'SKILL.md')).exists(),
    ).toBe(true);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('copies SKILL.md with valid frontmatter', async () => {
    process.exitCode = 0;
    const installedSkillFile = join(gapFreeSkillDirectory, 'SKILL.md');

    if (!(await Bun.file(installedSkillFile).exists())) {
      await runAddSkill(['gap-free-sequences']);
    }

    const skillContent = await readFile(installedSkillFile, 'utf8');

    expect(skillContent.startsWith('---')).toBe(true);
    expect(skillContent).toContain('\nname:');
  });

  it('throws when skill already installed', async () => {
    process.exitCode = 0;
    await mkdir(integerMoneySkillDirectory, { recursive: true });

    await runAddSkill(['integer-money']);

    expect(process.exitCode).toBe(1);
  });

  it('sets exitCode 1 for unknown skill name', async () => {
    process.exitCode = 0;

    await runAddSkill(['nonexistent-skill-xyz']);

    expect(process.exitCode).toBe(1);
  });

  it('--list includes all skills from manifest', async () => {
    process.exitCode = 0;
    const output: string[] = [];
    const originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => {
      output.push(args.map((arg) => String(arg)).join(' '));
    };

    try {
      await runAddSkill(['--list']);
    } finally {
      console.log = originalConsoleLog;
    }

    const manifestPath = resolve(
      process.cwd(),
      'packages/cli/skills/manifest.json',
    );
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      skills: Array<{ name: string }>;
    };

    const renderedOutput = output.join('\n');
    for (const skill of manifest.skills) {
      expect(renderedOutput).toContain(skill.name);
    }
  });
});

describe('cli help text', () => {
  it('includes add skill command', () => {
    expect(HELP_TEXT).toContain('add skill');
  });
});
