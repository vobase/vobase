import type { Database } from 'bun:sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';

import type { VobaseDb } from './client';
import { ensureCoreTables } from './ensure-core-tables';

type VobaseDbWithClient = VobaseDb & { $client: Database };

export function runMigrations(db: VobaseDb, migrationsFolder: string): void {
  ensureCoreTables((db as VobaseDbWithClient).$client);
  migrate(db, { migrationsFolder });
}
