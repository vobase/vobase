import { cp, mkdir, readdir, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type SkillDefinition = {
  name: string;
  description: string;
  category: string;
  enhances: string[];
};

type SkillsManifest = {
  skills: SkillDefinition[];
};

const SKILLS_TARGET_DIRECTORY = resolve(process.cwd(), '.agents', 'skills');

export async function runAddSkill(args: string[]): Promise<void> {
  const [firstArg] = args;

  if (firstArg === undefined || firstArg.length === 0) {
    console.error('Usage: vobase add skill <name>');
    console.error('       vobase add skill --list');
    process.exitCode = 1;
    return;
  }

  try {
    const skillsDirectory = await resolveSkillsDirectory();
    const manifest = await readManifest(skillsDirectory);

    if (firstArg === '--list') {
      await printSkillList(manifest.skills);
      return;
    }

    const skillName = firstArg;
    const requestedSkill = manifest.skills.find(
      (skill) => skill.name === skillName,
    );

    if (requestedSkill === undefined) {
      console.error(`Error: Unknown skill "${skillName}". Available skills:`);
      printAvailableSkills(manifest.skills);
      process.exitCode = 1;
      return;
    }

    const target = resolve(SKILLS_TARGET_DIRECTORY, skillName);
    if (await pathExists(target)) {
      console.error(`Error: Skill already installed at ${target}`);
      console.error(
        `Tip: Use .agents/skills/${skillName}/ directly in your AI tool context.`,
      );
      process.exitCode = 1;
      return;
    }

    await mkdir(SKILLS_TARGET_DIRECTORY, { recursive: true });

    const sourceSkillDirectory = resolve(skillsDirectory, skillName);
    if (!(await directoryExists(sourceSkillDirectory))) {
      console.error(
        `Error: Skill source directory not found: ${sourceSkillDirectory}`,
      );
      process.exitCode = 1;
      return;
    }

    const tmpTarget = `${target}.tmp.${Date.now()}`;
    await copyDirectory(sourceSkillDirectory, tmpTarget);
    await rename(tmpTarget, target);

    const missingEnhancements = await findMissingEnhancements(requestedSkill);
    if (missingEnhancements.length > 0) {
      const missingSkillList = missingEnhancements.join(', ');
      const firstMissingSkill = missingEnhancements[0];
      if (firstMissingSkill !== undefined) {
        console.warn(
          `⚠ Tip: This skill works best with: ${missingSkillList} (not installed). Run: vobase add skill ${firstMissingSkill}`,
        );
      }
    }

    console.log(
      `✓ Installed skill: ${skillName} → .agents/skills/${skillName}/`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  }
}

async function printSkillList(skills: SkillDefinition[]): Promise<void> {
  await printCategory(skills, 'core', 'Core Skills');
  await printCategory(skills, 'vertical', 'Vertical Skills (Singapore)');
}

async function printCategory(
  skills: SkillDefinition[],
  category: string,
  title: string,
): Promise<void> {
  const categorySkills = skills.filter((skill) => skill.category === category);
  if (categorySkills.length === 0) {
    return;
  }

  console.log(`${title}:`);
  for (const skill of categorySkills) {
    const target = resolve(SKILLS_TARGET_DIRECTORY, skill.name);
    const status = (await pathExists(target)) ? '[installed]' : '[available]';
    console.log(`  ${skill.name.padEnd(20)} ${status}  ${skill.description}`);
  }
  console.log('');
}

function printAvailableSkills(skills: SkillDefinition[]): void {
  for (const skill of skills) {
    console.error(`  ${skill.name}`);
  }
}

async function findMissingEnhancements(
  skill: SkillDefinition,
): Promise<string[]> {
  const missingEnhancements: string[] = [];

  for (const enhancedSkillName of skill.enhances) {
    const targetPath = resolve(SKILLS_TARGET_DIRECTORY, enhancedSkillName);
    if (!(await pathExists(targetPath))) {
      missingEnhancements.push(enhancedSkillName);
    }
  }

  return missingEnhancements;
}

async function readManifest(skillsDirectory: string): Promise<SkillsManifest> {
  const manifestPath = resolve(skillsDirectory, 'manifest.json');
  const manifestFile = Bun.file(manifestPath);
  if (!(await manifestFile.exists())) {
    throw new Error(`Unable to locate skills manifest: ${manifestPath}`);
  }

  const manifest = JSON.parse(await manifestFile.text()) as SkillsManifest;
  if (!Array.isArray(manifest.skills)) {
    throw new Error(`Invalid skills manifest: ${manifestPath}`);
  }

  return manifest;
}

async function copyDirectory(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await cp(sourcePath, targetPath);
    }
  }
}

async function resolveSkillsDirectory(): Promise<string> {
  const currentDirectory = resolve(fileURLToPath(import.meta.url), '..');
  const candidates = [
    resolve(currentDirectory, '../../skills'),
    resolve(currentDirectory, '../skills'),
    resolve(currentDirectory, './skills'),
    resolve(currentDirectory, '../../../skills'),
    resolve(process.cwd(), 'packages/cli/skills'),
    resolve(process.cwd(), 'skills'),
  ];

  for (const candidate of candidates) {
    if (await directoryExists(candidate)) {
      return candidate;
    }
  }

  throw new Error('Unable to locate CLI skills directory');
}

async function pathExists(pathValue: string): Promise<boolean> {
  try {
    await stat(pathValue);
    return true;
  } catch (error) {
    if (isErrnoCode(error, 'ENOENT')) {
      return false;
    }

    throw error;
  }
}

async function directoryExists(pathValue: string): Promise<boolean> {
  try {
    const pathStats = await stat(pathValue);
    return pathStats.isDirectory();
  } catch (error) {
    if (isErrnoCode(error, 'ENOENT')) {
      return false;
    }

    throw error;
  }
}

function isErrnoCode(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
