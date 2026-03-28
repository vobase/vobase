/**
 * PGlite → pg.Pool adapter for @chat-adapter/state-pg.
 *
 * state-pg requires a pg.Pool instance, but PGlite is in-process Postgres
 * with no TCP. This adapter wraps PGlite's query interface to satisfy
 * the subset of pg.Pool that state-pg actually uses:
 *   - pool.query(sql, values?) → { rows, rowCount }
 *   - pool.end() → no-op (PGlite lifecycle managed elsewhere)
 */
import type { PGlite } from '@electric-sql/pglite';

/** pg.Pool-shaped object — the subset that @chat-adapter/state-pg uses. */
export interface PoolLike {
  query(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: unknown[]; rowCount: number }>;
  end(): Promise<void>;
}

/** Wrap PGlite as a pg.Pool-shaped object for state-pg. */
export function createPGlitePoolAdapter(pglite: PGlite): PoolLike {
  const adapter = {
    async query(
      textOrConfig: string | { text: string; values?: unknown[] },
      values?: unknown[],
    ) {
      const sql =
        typeof textOrConfig === 'string' ? textOrConfig : textOrConfig.text;
      const params =
        typeof textOrConfig === 'string' ? values : textOrConfig.values;

      const result = await pglite.query(sql, params as unknown[]);
      return {
        rows: result.rows,
        rowCount: result.rows.length,
        command: '',
        oid: 0,
        fields: (result.fields || []).map((f: Record<string, unknown>) => ({
          name: f.name as string,
          tableID: (f.tableID as number) ?? 0,
          columnID: (f.columnID as number) ?? 0,
          dataTypeID: (f.dataTypeID as number) ?? 0,
          dataTypeSize: (f.dataTypeSize as number) ?? -1,
          dataTypeModifier: (f.dataTypeModifier as number) ?? -1,
          format: 'text' as const,
        })),
      };
    },

    async end() {
      // No-op — PGlite lifecycle managed by Drizzle/core
    },
  };

  return adapter as PoolLike;
}
