import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'bun:sqlite';

const fixturesDir = dirname(fileURLToPath(import.meta.url));
const includeDirective = /^\s*--!include\s+(.+)\s*$/;

function readWithIncludes(filePath: string, visited: Set<string>): string {
  if (visited.has(filePath)) {
    throw new Error(`Circular SQL fixture include detected: ${filePath}`);
  }
  visited.add(filePath);
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const resolved: string[] = [];
  for (const line of lines) {
    const match = includeDirective.exec(line);
    if (!match) {
      resolved.push(line);
      continue;
    }
    const includePath = match[1]?.trim();
    if (!includePath) continue;
    if (includePath.includes('*')) throw new Error(`Glob includes not supported: ${includePath}`);
    const absoluteIncludePath = resolve(dirname(filePath), includePath);
    resolved.push(readWithIncludes(absoluteIncludePath, visited));
  }
  visited.delete(filePath);
  return resolved.join('\n');
}

export function applyFixtures(db: Database): void {
  const entrypoint = resolve(fixturesDir, 'current.sql');
  const sql = readWithIncludes(entrypoint, new Set<string>());
  const executableSql = sql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();
  if (!executableSql) return;
  db.exec(sql);
}
