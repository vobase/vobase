import { eq, getTableColumns, getTableName } from 'drizzle-orm';
import type { Table } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

interface ColumnMeta {
  primary?: boolean;
  dataType?: string;
}

import type { AuthUser } from '../contracts/auth';
import type { VobaseDb } from '../db';
import type { VobaseModule } from '../module';

interface CrudContext {
  db: VobaseDb;
  user: AuthUser | null;
  organizationEnabled: boolean;
}

function checkWritePermission(ctx: CrudContext): string | null {
  if (!ctx.user) return 'Authentication required';
  if (ctx.organizationEnabled) {
    // When org is enabled, any authenticated user can write
    return null;
  }
  // Without org, require admin role for writes
  if (ctx.user.role !== 'admin') return 'Forbidden: admin role required for write operations';
  return null;
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }], isError: true as const };
}

function jsonResult(data: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

export function registerCrudTools(
  server: McpServer,
  modules: VobaseModule[],
  ctx: CrudContext,
  excludeMap: Map<string, Set<string>>,
) {
  for (const mod of modules) {
    if (!mod.schema || Object.keys(mod.schema).length === 0) continue;

    const moduleExcludes = excludeMap.get(mod.name) ?? new Set();

    for (const [schemaKey, tableObj] of Object.entries(mod.schema)) {
      if (moduleExcludes.has(schemaKey)) continue;

      // Verify it's a Drizzle table
      let tableName: string;
      try {
        tableName = getTableName(tableObj as unknown as Table);
      } catch {
        continue;
      }

      const table = tableObj as SQLiteTable;
      let columns: ReturnType<typeof getTableColumns>;
      try {
        columns = getTableColumns(table);
      } catch {
        continue;
      }
      if (!columns) continue;

      // Find primary key column
      const pkEntry = Object.entries(columns).find(([, col]) => (col as unknown as ColumnMeta).primary);
      if (!pkEntry) continue;
      const [pkKey] = pkEntry;
      const pkCol = columns[pkKey]!;
      const pkZod = (pkCol as unknown as ColumnMeta).dataType === 'number' ? z.number() : z.string();

      // Clean name for tools (strip _ prefix from built-in tables)
      const cleanName = tableName.replace(/^_/, '');

      // LIST
      server.registerTool(
        `list_${cleanName}`,
        {
          description: `List rows from ${tableName} table.`,
          inputSchema: z.object({
            limit: z.number().int().positive().max(100).optional(),
            offset: z.number().int().nonnegative().optional(),
          }),
          annotations: { readOnlyHint: true },
        },
        async ({ limit, offset }) => {
          const rows = ctx.db.select().from(table).limit(limit ?? 50).offset(offset ?? 0).all();
          return jsonResult({ rows, count: rows.length });
        },
      );

      // GET
      server.registerTool(
        `get_${cleanName}`,
        {
          description: `Get a single row from ${tableName} by ID.`,
          inputSchema: z.object({ id: pkZod }),
          annotations: { readOnlyHint: true },
        },
        async ({ id }) => {
          const row = ctx.db.select().from(table).where(eq(pkCol, id)).get();
          if (!row) return errorResult('Not found');
          return jsonResult(row as Record<string, unknown>);
        },
      );

      // CREATE
      server.registerTool(
        `create_${cleanName}`,
        {
          description: `Insert a new row into ${tableName}.`,
          inputSchema: z.object({ data: z.record(z.string(), z.unknown()) }),
        },
        async ({ data }) => {
          const permError = checkWritePermission(ctx);
          if (permError) return errorResult(permError);
          try {
            const result = ctx.db.insert(table).values(data as Record<string, unknown>).returning().get();
            return jsonResult(result as Record<string, unknown>);
          } catch (e: unknown) {
            return errorResult(e instanceof Error ? e.message : String(e));
          }
        },
      );

      // UPDATE
      server.registerTool(
        `update_${cleanName}`,
        {
          description: `Update a row in ${tableName} by ID.`,
          inputSchema: z.object({ id: pkZod, data: z.record(z.string(), z.unknown()) }),
        },
        async ({ id, data }) => {
          const permError = checkWritePermission(ctx);
          if (permError) return errorResult(permError);
          try {
            const result = ctx.db.update(table).set(data as Record<string, unknown>).where(eq(pkCol, id)).returning().get();
            if (!result) return errorResult('Not found');
            return jsonResult(result as Record<string, unknown>);
          } catch (e: unknown) {
            return errorResult(e instanceof Error ? e.message : String(e));
          }
        },
      );

      // DELETE
      server.registerTool(
        `delete_${cleanName}`,
        {
          description: `Delete a row from ${tableName} by ID.`,
          inputSchema: z.object({ id: pkZod }),
        },
        async ({ id }) => {
          const permError = checkWritePermission(ctx);
          if (permError) return errorResult(permError);
          try {
            const result = ctx.db.delete(table).where(eq(pkCol, id)).returning().get();
            if (!result) return errorResult('Not found');
            return jsonResult({ deleted: true });
          } catch (e: unknown) {
            return errorResult(e instanceof Error ? e.message : String(e));
          }
        },
      );
    }
  }
}
