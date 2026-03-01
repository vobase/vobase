import type { Database } from 'bun:sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';

import type { VobaseDb } from './client';
import { applyFixtures } from './fixtures/apply-fixtures';

type VobaseDbWithClient = VobaseDb & { $client: Database };

export function runMigrations(db: VobaseDb, migrationsFolder: string): void {
  applyFixtures((db as VobaseDbWithClient).$client);
  migrate(db, { migrationsFolder });
}
