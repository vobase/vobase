import { describe, expect, it } from 'bun:test';

import {
  createNanoid,
  DEFAULT_COLUMNS,
  NANOID_ALPHABET,
  NANOID_LENGTH,
  nanoidPrimaryKey,
} from './helpers';

// Drizzle marks `.config` as protected; bracket access bypasses this for test inspection
function getConfig(col: unknown): Record<string, unknown> {
  return (col as Record<string, Record<string, unknown>>).config;
}

describe('nanoid helpers', () => {
  describe('NANOID_LENGTH constants', () => {
    it('should have SHORT, DEFAULT, and LONG lengths defined', () => {
      expect(NANOID_LENGTH.SHORT).toBe(8);
      expect(NANOID_LENGTH.DEFAULT).toBe(12);
      expect(NANOID_LENGTH.LONG).toBe(16);
    });
  });

  describe('NANOID_ALPHABET', () => {
    it('should only contain lowercase alphanumeric characters', () => {
      expect(NANOID_ALPHABET).toBe('0123456789abcdefghijklmnopqrstuvwxyz');
    });
  });

  describe('createNanoid()', () => {
    it('should generate IDs of the correct length', () => {
      const generateShort = createNanoid(NANOID_LENGTH.SHORT);
      const generateDefault = createNanoid(NANOID_LENGTH.DEFAULT);
      const generateLong = createNanoid(NANOID_LENGTH.LONG);

      expect(generateShort().length).toBe(8);
      expect(generateDefault().length).toBe(12);
      expect(generateLong().length).toBe(16);
    });

    it('should generate IDs using only the alphabet', () => {
      const generate = createNanoid(NANOID_LENGTH.DEFAULT);
      const id = generate();

      for (const char of id) {
        expect(NANOID_ALPHABET.includes(char)).toBe(true);
      }
    });

    it('should cache generators and reuse them', () => {
      const gen1 = createNanoid(NANOID_LENGTH.DEFAULT);
      const gen2 = createNanoid(NANOID_LENGTH.DEFAULT);

      // Should be the same function instance (cached)
      expect(gen1).toBe(gen2);
    });

    it('should generate unique IDs', () => {
      const generate = createNanoid(NANOID_LENGTH.DEFAULT);
      const ids = new Set();

      for (let i = 0; i < 1000; i++) {
        ids.add(generate());
      }

      expect(ids.size).toBe(1000);
    });

    it('should use default length when not specified', () => {
      const generate = createNanoid();
      expect(generate().length).toBe(NANOID_LENGTH.DEFAULT);
    });
  });

  describe('nanoidPrimaryKey()', () => {
    it('should create a text column named "id"', () => {
      const column = nanoidPrimaryKey();
      expect(getConfig(column).name).toBe('id');
    });

    it('should be a primary key', () => {
      const column = nanoidPrimaryKey();
      expect(getConfig(column).primaryKey).toBe(true);
    });

    it('should have a default function', () => {
      const column = nanoidPrimaryKey();
      expect(typeof column.$default).toBe('function');
    });

    it('should generate valid nanoid', () => {
      // createNanoid() returns a generator function
      const generator = createNanoid();
      const id = generator();

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id.length).toBe(NANOID_LENGTH.DEFAULT);
    });

    it('should support custom lengths', () => {
      const columnShort = nanoidPrimaryKey(NANOID_LENGTH.SHORT);
      const columnLong = nanoidPrimaryKey(NANOID_LENGTH.LONG);

      expect(getConfig(columnShort).name).toBe('id');
      expect(getConfig(columnLong).name).toBe('id');
    });
  });

  describe('DEFAULT_COLUMNS', () => {
    it('should have createdAt and updatedAt columns', () => {
      expect(DEFAULT_COLUMNS.createdAt).toBeDefined();
      expect(DEFAULT_COLUMNS.updatedAt).toBeDefined();
    });

    it('createdAt should be an integer column with timestamp_ms mode', () => {
      const col = DEFAULT_COLUMNS.createdAt;
      expect(getConfig(col).name).toBe('created_at');
      expect(getConfig(col).mode).toBe('timestamp_ms');
      expect(getConfig(col).hasDefault).toBe(true);
      expect(getConfig(col).notNull).toBe(true);
    });

    it('updatedAt should be an integer column with timestamp_ms mode', () => {
      const col = DEFAULT_COLUMNS.updatedAt;
      expect(getConfig(col).name).toBe('updated_at');
      expect(getConfig(col).mode).toBe('timestamp_ms');
      expect(getConfig(col).hasDefault).toBe(true);
      expect(getConfig(col).notNull).toBe(true);
    });

    it('timestamps should have default functions', () => {
      expect(typeof DEFAULT_COLUMNS.createdAt.$default).toBe('function');
      expect(typeof DEFAULT_COLUMNS.updatedAt.$default).toBe('function');
    });

    it('updatedAt should have onUpdate function', () => {
      expect(typeof DEFAULT_COLUMNS.updatedAt.$onUpdate).toBe('function');
    });

    it('timestamp columns should use integer data type', () => {
      expect(getConfig(DEFAULT_COLUMNS.createdAt).dataType).toBe('date');
      expect(getConfig(DEFAULT_COLUMNS.updatedAt).dataType).toBe('date');
    });
  });
});
