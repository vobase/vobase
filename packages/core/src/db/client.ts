import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';

export type VobaseDb = ReturnType<typeof drizzle>;

export function createDatabase(dbPath: string): VobaseDb {
  const sqlite = new Database(dbPath);

  sqlite.run('PRAGMA journal_mode=WAL');
  sqlite.run('PRAGMA busy_timeout=5000');
  sqlite.run('PRAGMA synchronous=NORMAL');
  sqlite.run('PRAGMA foreign_keys=ON');

  return drizzle({ client: sqlite });
}
