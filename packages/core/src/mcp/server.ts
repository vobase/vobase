import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { desc } from 'drizzle-orm';
import { z } from 'zod';

import type { AuthUser } from '../contracts/auth';
import type { VobaseDb } from '../db';
import { auditLog } from '../modules/audit/schema';
import type { VobaseModule } from '../module';
import { registerCrudTools } from './crud';

const DEFAULT_LOG_LIMIT = 50;
const MAX_LOG_LIMIT = 100;

export interface McpDeps {
  db: VobaseDb;
  modules: VobaseModule[];
  /** Validate an API key. Returns user ID if valid, null if invalid. */
  verifyApiKey?: (key: string) => Promise<{ userId: string } | null>;
  /** Whether the organization plugin is enabled (affects CRUD authorization). */
  organizationEnabled?: boolean;
}

function toToolResult(payload: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function getSortedTableNames(schema: Record<string, unknown>): string[] {
  return Object.keys(schema).sort((left, right) => left.localeCompare(right));
}

function getSchemaTableNames(modules: VobaseModule[]): string[] {
  return Array.from(
    new Set(modules.flatMap((module) => getSortedTableNames(module.schema))),
  ).sort((left, right) => left.localeCompare(right));
}

export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: 'vobase', version: '0.1.0' });

  server.registerTool(
    'list_modules',
    {
      description: 'List registered vobase modules.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      return toToolResult({
        modules: deps.modules.map((module) => ({ name: module.name })),
      });
    },
  );

  server.registerTool(
    'read_module',
    {
      description: 'Read table names from one module schema.',
      inputSchema: z.object({ name: z.string().min(1) }),
      annotations: { readOnlyHint: true },
    },
    async ({ name }) => {
      const selectedModule = deps.modules.find(
        (module) => module.name === name,
      );

      return toToolResult({
        name,
        tables: selectedModule
          ? getSortedTableNames(selectedModule.schema)
          : [],
      });
    },
  );

  server.registerTool(
    'get_schema',
    {
      description: 'List all table names across every module schema.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      return toToolResult({ tables: getSchemaTableNames(deps.modules) });
    },
  );

  server.registerTool(
    'view_logs',
    {
      description: 'Return recent entries from _audit_log.',
      inputSchema: z.object({
        limit: z.number().int().positive().max(MAX_LOG_LIMIT).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => {
      const effectiveLimit = limit ?? DEFAULT_LOG_LIMIT;
      const entries = deps.db
        .select()
        .from(auditLog)
        .orderBy(desc(auditLog.createdAt))
        .limit(effectiveLimit)
        .all()
        .map((entry) => ({
          id: entry.id,
          event: entry.event,
          actorId: entry.actorId,
          actorEmail: entry.actorEmail,
          ip: entry.ip,
          details: entry.details,
          createdAt:
            entry.createdAt instanceof Date
              ? entry.createdAt.toISOString()
              : String(entry.createdAt),
        }));

      return toToolResult({ entries });
    },
  );

  return server;
}

export function createMcpHandler(
  deps: McpDeps,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    // API key authentication (optional — CRUD tools require it, discovery tools don't)
    let authenticatedUser: AuthUser | null = null;

    if (deps.verifyApiKey) {
      const authHeader = req.headers.get('authorization');
      const key = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;

      if (key) {
        const result = await deps.verifyApiKey(key);
        if (result) {
          authenticatedUser = {
            id: result.userId,
            email: '',
            name: '',
            role: 'admin', // API key holders get admin role for CRUD
          };
        }
      }
    }

    const server = createMcpServer(deps);

    // Register CRUD tools only when authenticated via API key
    if (authenticatedUser) {
      const excludeMap = new Map<string, Set<string>>();
      registerCrudTools(server, deps.modules, {
        db: deps.db,
        user: authenticatedUser,
        organizationEnabled: deps.organizationEnabled ?? false,
      }, excludeMap);
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await server.connect(transport);

    try {
      return await transport.handleRequest(req);
    } finally {
      await server.close();
    }
  };
}
