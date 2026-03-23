import { describe, expect, it } from 'bun:test';
import { getTableColumns, getTableName } from 'drizzle-orm';

import { auditLog } from '../modules/audit/schema';
import { authUser } from '../modules/auth/schema';

/** Drizzle column metadata not exposed in public types */
interface ColumnMeta {
  primary?: boolean;
}

/**
 * Drizzle Introspection Spike (US-005)
 *
 * Validates that Drizzle table column metadata (types, nullability, defaults,
 * primary keys) is extractable via getTableColumns(). This API is used in
 * Step 2.2 (MCP CRUD generation) to build Zod input schemas dynamically.
 *
 * API reference for MCP CRUD generation:
 * - getTableColumns(table) → Record<string, Column> with .dataType, .notNull, .hasDefault, .primary, .columnType
 * - getTableName(table) → string (the SQL table name)
 */
describe('Drizzle table introspection', () => {
  it('extracts column names from a table', () => {
    const columns = getTableColumns(auditLog);
    const names = Object.keys(columns);
    expect(names).toContain('id');
    expect(names).toContain('event');
    expect(names).toContain('actorId');
    expect(names).toContain('createdAt');
  });

  it('extracts SQL data types', () => {
    const columns = getTableColumns(auditLog);
    expect(columns.id.dataType).toBe('string'); // text
    expect(columns.event.dataType).toBe('string'); // text
    expect(columns.createdAt.dataType).toBe('object date');
  });

  it('extracts columnType for precise SQL type', () => {
    const columns = getTableColumns(auditLog);
    expect(columns.id.columnType).toBe('PgText');
    expect(columns.createdAt.columnType).toBe('PgTimestamp');
  });

  it('extracts nullability', () => {
    const columns = getTableColumns(auditLog);
    expect(columns.event.notNull).toBe(true);
    expect(columns.actorId.notNull).toBe(false);
  });

  it('extracts hasDefault flag', () => {
    const columns = getTableColumns(auditLog);
    // id has a $defaultFn (nanoid)
    expect(columns.id.hasDefault).toBe(true);
    // event has no default
    expect(columns.event.hasDefault).toBe(false);
  });

  it('extracts primary key flag via .primary', () => {
    const columns = getTableColumns(auditLog);
    expect((columns.id as unknown as ColumnMeta).primary).toBe(true);
    expect((columns.event as unknown as ColumnMeta).primary).toBe(false);
  });

  it('extracts SQL table name', () => {
    const name = getTableName(auditLog);
    expect(name).toBe('audit_log');
  });

  it('works on auth user table with all field types', () => {
    const columns = getTableColumns(authUser);
    expect((columns.id as unknown as ColumnMeta).primary).toBe(true);
    expect(columns.email.notNull).toBe(true);
    expect(columns.image.notNull).toBe(false);
    expect(columns.role.hasDefault).toBe(true);
    expect(columns.emailVerified.columnType).toBe('PgBoolean');
  });
});
