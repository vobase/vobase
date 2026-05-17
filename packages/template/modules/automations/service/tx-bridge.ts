/**
 * Adapts a Drizzle postgres-js transaction handle into the `IDatabase` shape
 * that pg-boss `send()`/`insert()` accept via `SendOptions.db`. The cast to
 * `{ session: { client } }` reaches into Drizzle internals (verified against
 * `drizzle-orm/postgres-js/session.d.ts:18-39` on 2026-05-17); this is the
 * ONLY place in the template that does so. If Drizzle changes the internal
 * shape we update this file and nothing else.
 *
 * The `session.client` field is typed as `TSQL extends Sql` on the session
 * class. Inside a `db.transaction()` callback the session is always a
 * `PostgresJsSession<TransactionSql, TRelations>`, so the bound client is the
 * live `TransactionSql` for that open Postgres tx. Running pg-boss
 * `INSERT INTO pgboss.job ...` through this client ensures the job row is
 * durable iff the producer's other writes commit; rollback ⇒ job vanishes
 * with the producer tx.
 */
import type { TransactionSql } from 'postgres'

import type { Tx } from '~/runtime'

/** pg-boss `IDatabase` shape (pg-boss/dist/types.d.ts:16-20). */
export interface PgBossDb {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>
}

/**
 * Bridge a Drizzle `db.transaction()` handle into a pg-boss `IDatabase`.
 *
 * Pass the returned object as `{ db: bridgedDb }` in `boss.send()` /
 * `boss.insert()` options so the pg-boss INSERT runs inside the same Postgres
 * tx as the producer's writes.
 *
 * @param tx — the `tx` argument received inside a `db.transaction(async (tx) => …)` callback.
 */
export function bridgeTxForPgBoss(tx: Tx): PgBossDb {
  // The `tx` object at runtime is a `PostgresJsTransaction` instance whose
  // `session` field is `PostgresJsSession<TransactionSql, TRelations>`.
  // `PostgresJsSession.client` (session.d.ts:19) is the bound postgres-js Sql
  // handle — for a transaction session this is a `TransactionSql`.
  const sql = (tx as unknown as { session: { client: TransactionSql } }).session.client
  return {
    async executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> {
      // postgres-js Sql.unsafe(query, parameters) executes arbitrary SQL and
      // returns a RowList. Cast to unknown[] so the shape matches IDatabase.
      // biome-ignore lint/suspicious/noExplicitAny: postgres-js TransactionSql types parameters as ParameterOrJSON<never>[] which rejects unknown[]; any[] is the only viable cast here
      const result = await sql.unsafe(text, (values ?? []) as any[])
      return { rows: result as unknown as unknown[] }
    },
  }
}
