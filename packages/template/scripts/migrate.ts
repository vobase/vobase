/**
 * Production migration script.
 * Uses drizzle-orm's programmatic migrate() instead of drizzle-kit CLI
 * to avoid the beta CLI bug with SQLite (CREATE SCHEMA not supported).
 */
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';

const dbPath = process.env.DATABASE_PATH || './data/vobase.db';
const db = drizzle(dbPath);

console.log(`[migrate] Running migrations on ${dbPath}...`);
migrate(db, { migrationsFolder: './drizzle' });
console.log('[migrate] Done.');
