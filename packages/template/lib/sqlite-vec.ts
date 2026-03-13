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
      // Try the npm package path
      const vecPath = require.resolve('sqlite-vec').replace(/\/[^/]+$/, '/vec0');
      db.loadExtension(vecPath);
      return true;
    } catch (err) {
      console.warn(
        '[sqlite-vec] Failed to load vec0 extension. Vector search will not be available.\n' +
        'On macOS, ensure Homebrew SQLite is installed: brew install sqlite'
      );
      return false;
    }
  }
}
