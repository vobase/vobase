import { sql } from 'drizzle-orm';
import { text, timestamp } from 'drizzle-orm/pg-core';
import { customAlphabet } from 'nanoid';

export const NANOID_LENGTH = { SHORT: 6, DEFAULT: 8, LONG: 12 } as const;
export const NANOID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

// Cache generators to avoid recreating
const nanoidGenerators = new Map<number, () => string>();

/**
 * Create or retrieve a cached nanoid generator with the specified length.
 * Uses a custom alphabet of lowercase alphanumeric characters.
 */
export function createNanoid(
  length: number = NANOID_LENGTH.DEFAULT,
): () => string {
  if (!nanoidGenerators.has(length)) {
    nanoidGenerators.set(length, customAlphabet(NANOID_ALPHABET, length));
  }
  const generator = nanoidGenerators.get(length);

  if (!generator) {
    throw new Error(`No nanoid generator for length ${length}`);
  }

  return generator;
}

/**
 * Create a nanoid-based primary key column for Postgres.
 * Uses the database-side nanoid() function as default (requires nanoid extension).
 */
export const nanoidPrimaryKey = (length: number = NANOID_LENGTH.DEFAULT) =>
  text('id')
    .primaryKey()
    .notNull()
    .default(sql`nanoid(${sql.raw(String(length))})`);

/**
 * Default timestamp columns for Postgres using timestamptz.
 * createdAt: set on insert via database default
 * updatedAt: set on insert via database default, updated on every row modification
 */
export const DEFAULT_COLUMNS = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
} as const;
