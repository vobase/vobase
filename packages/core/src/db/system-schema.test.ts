import { describe, expect, it } from 'bun:test';
import { getTableColumns } from 'drizzle-orm';

import { auditLog, recordAudits, sequences } from './system-schema';

describe('System Schema - Table Definitions', () => {
  describe('auditLog table', () => {
    it('should have correct column names', () => {
      const columns = getTableColumns(auditLog);
      expect(Object.keys(columns)).toEqual([
        'id',
        'event',
        'actorId',
        'actorEmail',
        'ip',
        'details',
        'createdAt',
      ]);
    });

    it('should have id as primary key with nanoid default', () => {
      const columns = getTableColumns(auditLog);
      const idCol = columns.id;
      expect(idCol.primary).toBe(true);
      expect(typeof idCol.defaultFn).toBe('function');
    });

    it('should have event as required text field', () => {
      const columns = getTableColumns(auditLog);
      const eventCol = columns.event;
      expect(eventCol.notNull).toBe(true);
      expect(eventCol.dataType).toBe('string');
    });

    it('should have createdAt with timestamp_ms mode and default function', () => {
      const columns = getTableColumns(auditLog);
      const createdAtCol = columns.createdAt;
      expect(createdAtCol.notNull).toBe(true);
      expect(typeof createdAtCol.defaultFn).toBe('function');
    });

    it('should NOT have updatedAt column (audit events are immutable)', () => {
      const columns = getTableColumns(auditLog);
      expect('updatedAt' in columns).toBe(false);
    });

    it('should have nullable actorId and actorEmail fields', () => {
      const columns = getTableColumns(auditLog);
      expect(columns.actorId.notNull).toBe(false);
      expect(columns.actorEmail.notNull).toBe(false);
    });

    it('should have nullable details field for JSON data', () => {
      const columns = getTableColumns(auditLog);
      expect(columns.details.notNull).toBe(false);
      expect(columns.details.dataType).toBe('string');
    });
  });

  describe('sequences table', () => {
    it('should have correct column names', () => {
      const columns = getTableColumns(sequences);
      expect(Object.keys(columns)).toEqual([
        'id',
        'prefix',
        'currentValue',
        'updatedAt',
      ]);
    });

    it('should have id as primary key with nanoid default', () => {
      const columns = getTableColumns(sequences);
      const idCol = columns.id;
      expect(idCol.primary).toBe(true);
      expect(typeof idCol.defaultFn).toBe('function');
    });

    it('should have unique prefix field', () => {
      const columns = getTableColumns(sequences);
      const prefixCol = columns.prefix;
      expect(prefixCol.notNull).toBe(true);
      expect(prefixCol.isUnique).toBe(true);
    });

    it('should have currentValue with integer type and default 0', () => {
      const columns = getTableColumns(sequences);
      const currentValueCol = columns.currentValue;
      expect(currentValueCol.notNull).toBe(true);
      expect(currentValueCol.default).toBe(0);
      expect(currentValueCol.dataType).toBe('number int53');
    });

    it('should have updatedAt with timestamp_ms mode and both default and onUpdate', () => {
      const columns = getTableColumns(sequences);
      const updatedAtCol = columns.updatedAt;
      expect(updatedAtCol.notNull).toBe(true);
      expect(typeof updatedAtCol.defaultFn).toBe('function');
      expect(typeof updatedAtCol.onUpdateFn).toBe('function');
    });
  });

  describe('recordAudits table', () => {
    it('should have correct column names', () => {
      const columns = getTableColumns(recordAudits);
      expect(Object.keys(columns)).toEqual([
        'id',
        'tableName',
        'recordId',
        'oldData',
        'newData',
        'changedBy',
        'createdAt',
      ]);
    });

    it('should have id as primary key with nanoid default', () => {
      const columns = getTableColumns(recordAudits);
      const idCol = columns.id;
      expect(idCol.primary).toBe(true);
      expect(typeof idCol.defaultFn).toBe('function');
    });

    it('should have required tableName and recordId fields', () => {
      const columns = getTableColumns(recordAudits);
      expect(columns.tableName.notNull).toBe(true);
      expect(columns.recordId.notNull).toBe(true);
    });

    it('should have nullable oldData and newData for JSON change tracking', () => {
      const columns = getTableColumns(recordAudits);
      expect(columns.oldData.notNull).toBe(false);
      expect(columns.newData.notNull).toBe(false);
      expect(columns.oldData.dataType).toBe('string');
      expect(columns.newData.dataType).toBe('string');
    });

    it('should have nullable changedBy field for user tracking', () => {
      const columns = getTableColumns(recordAudits);
      expect(columns.changedBy.notNull).toBe(false);
    });

    it('should have createdAt with timestamp_ms mode and default function', () => {
      const columns = getTableColumns(recordAudits);
      const createdAtCol = columns.createdAt;
      expect(createdAtCol.notNull).toBe(true);
      expect(typeof createdAtCol.defaultFn).toBe('function');
    });

    it('should NOT have updatedAt column', () => {
      const columns = getTableColumns(recordAudits);
      expect('updatedAt' in columns).toBe(false);
    });
  });
});
