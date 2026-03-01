import { customAlphabet } from 'nanoid';
import { integer, text } from 'drizzle-orm/sqlite-core';

export const NANOID_LENGTH = { SHORT: 8, DEFAULT: 12, LONG: 16 } as const;
export const NANOID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

// Cache generators to avoid recreating
const nanoidGenerators = new Map<number, () => string>();

/**
 * Create or retrieve a cached nanoid generator with the specified length.
 * Uses a custom alphabet of lowercase alphanumeric characters.
 */
export function createNanoid(length: number = NANOID_LENGTH.DEFAULT): () => string {
  if (!nanoidGenerators.has(length)) {
    nanoidGenerators.set(length, customAlphabet(NANOID_ALPHABET, length));
  }
  return nanoidGenerators.get(length)!;
}

/**
 * Create a nanoid-based primary key column for SQLite.
 * Generates a 12-character ID by default (customizable).
 */
export const nanoidPrimaryKey = (length: number = NANOID_LENGTH.DEFAULT) =>
  text('id').primaryKey().$defaultFn(() => createNanoid(length)());

/**
 * Default timestamp columns for SQLite using timestamp_ms mode.
 * createdAt: set on insert and never updated
 * updatedAt: set on insert and updated on every row modification
 */
export const DEFAULT_COLUMNS = {
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
} as const;
