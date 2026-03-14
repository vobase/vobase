import { Database } from 'bun:sqlite';
import { platform } from 'node:os';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Set up sqlite-vec extension support.
 * Must be called BEFORE createApp() since createApp → createDatabase → new Database()
 * and sqlite-vec requires a custom SQLite on macOS.
 */
export function setupSqliteVec(): void {
  if (platform() !== 'darwin') return;

  // macOS: Bun ships its own SQLite which doesn't support loadable extensions.
  // We need Homebrew's SQLite which has extension loading enabled.
  const brewPrefix = existsSync('/opt/homebrew') ? '/opt/homebrew' : '/usr/local';
  const sqlitePath = `${brewPrefix}/opt/sqlite/lib/libsqlite3.dylib`;

  if (!existsSync(sqlitePath)) {
    console.warn(
      '[sqlite-vec] Homebrew SQLite not found. Install with: brew install sqlite\n' +
      '[sqlite-vec] Vector search will not be available until SQLite is installed.'
    );
    return;
  }

  try {
    Database.setCustomSQLite(sqlitePath);
  } catch (err) {
    console.warn('[sqlite-vec] Failed to set custom SQLite:', err);
  }
}

/**
 * Load the sqlite-vec extension into a database instance.
 * Called from module init hooks after the database is created.
 */
export function loadSqliteVec(db: InstanceType<typeof Database>): boolean {
  try {
    db.loadExtension('vec0');
    return true;
  } catch {
    try {
      // Walk node_modules/.bun to find the sqlite-vec platform package
      // Check both cwd and monorepo root (Bun hoists to root node_modules)
      const { readdirSync } = require('node:fs');
      const { join, resolve } = require('node:path');
      const candidates = [
        join(process.cwd(), 'node_modules', '.bun'),
        join(resolve(process.cwd(), '..', '..'), 'node_modules', '.bun'),
        join(resolve(import.meta.dir, '..'), 'node_modules', '.bun'),
        join(resolve(import.meta.dir, '..', '..', '..'), 'node_modules', '.bun'),
      ];
      let bunModules = '';
      for (const c of candidates) {
        if (existsSync(c)) { bunModules = c; break; }
      }
      if (!bunModules) throw new Error('node_modules/.bun not found');
      const dirs = readdirSync(bunModules).filter((d: string) => d.startsWith('sqlite-vec-'));
      for (const dir of dirs) {
        const innerPath = join(bunModules, dir, 'node_modules');
        if (!existsSync(innerPath)) continue;
        const innerDirs = readdirSync(innerPath).filter((d: string) => d.startsWith('sqlite-vec-'));
        for (const inner of innerDirs) {
          const vecPath = join(innerPath, inner, 'vec0');
          if (existsSync(`${vecPath}.dylib`) || existsSync(`${vecPath}.so`)) {
            db.loadExtension(vecPath);
            return true;
          }
        }
      }
      throw new Error('vec0 extension not found in node_modules');
    } catch (err) {
      console.warn(
        '[sqlite-vec] Failed to load vec0 extension. Vector search will not be available.\n' +
        'On macOS, ensure Homebrew SQLite is installed: brew install sqlite'
      );
      return false;
    }
  }
}
