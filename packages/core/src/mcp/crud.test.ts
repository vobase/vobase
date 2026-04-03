import { beforeAll, describe, expect, it } from 'bun:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { drizzle } from 'drizzle-orm/pglite';
import { Hono } from 'hono';

import type { VobaseDb } from '../db/client';
import type { VobaseModule } from '../module';
import { auditLog } from '../modules/audit/schema';
import { createTestPGlite } from '../test-helpers';
import { registerCrudTools } from './crud';

/** MCP SDK internal — not in public types, used only for test assertions */
interface McpServerInternals {
  _registeredTools: Record<string, unknown>;
}

let db: VobaseDb;

beforeAll(async () => {
  const pg = await createTestPGlite();
  await pg.query(`
    CREATE TABLE IF NOT EXISTS _audit_log (
      id TEXT PRIMARY KEY NOT NULL,
      event TEXT NOT NULL,
      actor_id TEXT,
      actor_email TEXT,
      ip TEXT,
      details TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  db = drizzle({ client: pg }) as unknown as VobaseDb;
});

describe('registerCrudTools', () => {
  it('registers 5 CRUD tools per real Drizzle table', () => {
    const server = new McpServer({ name: 'test', version: '0.1.0' });

    const modules: VobaseModule[] = [
      {
        name: 'audit',
        schema: { auditLog },
        routes: new Hono(),
      },
    ];

    registerCrudTools(
      server,
      modules,
      {
        db,
        user: { id: 'u1', email: 'a@b.com', name: 'Test', role: 'admin' },
      },
      new Map(),
    );

    const tools = (server as unknown as McpServerInternals)._registeredTools;
    const toolNames = Object.keys(tools);

    expect(toolNames).toContain('list_audit_log');
    expect(toolNames).toContain('get_audit_log');
    expect(toolNames).toContain('create_audit_log');
    expect(toolNames).toContain('update_audit_log');
    expect(toolNames).toContain('delete_audit_log');
  });

  it('skips non-Drizzle schema entries gracefully', () => {
    const server = new McpServer({ name: 'test', version: '0.1.0' });

    const modules: VobaseModule[] = [
      {
        name: 'mock',
        schema: { fakeThing: {} },
        routes: new Hono(),
      },
    ];

    registerCrudTools(
      server,
      modules,
      {
        db,
        user: null,
      },
      new Map(),
    );

    const tools = (server as unknown as McpServerInternals)._registeredTools;
    const toolNames = Object.keys(tools);
    expect(toolNames.filter((n: string) => n.includes('fakeThing'))).toEqual(
      [],
    );
  });

  it('respects exclude map', () => {
    const server = new McpServer({ name: 'test', version: '0.1.0' });

    const modules: VobaseModule[] = [
      {
        name: 'audit',
        schema: { auditLog },
        routes: new Hono(),
      },
    ];

    const excludeMap = new Map([['audit', new Set(['auditLog'])]]);

    registerCrudTools(
      server,
      modules,
      {
        db,
        user: { id: 'u1', email: 'a@b.com', name: 'Test', role: 'admin' },
      },
      excludeMap,
    );

    const tools = (server as unknown as McpServerInternals)._registeredTools;
    const toolNames = Object.keys(tools);
    expect(toolNames.filter((n: string) => n.includes('audit_log'))).toEqual(
      [],
    );
  });

  it('write tools are registered for authenticated users', () => {
    const server = new McpServer({ name: 'test', version: '0.1.0' });

    const modules: VobaseModule[] = [
      {
        name: 'audit',
        schema: { auditLog },
        routes: new Hono(),
      },
    ];

    registerCrudTools(
      server,
      modules,
      {
        db,
        user: { id: 'u1', email: 'a@b.com', name: 'Test', role: 'user' },
      },
      new Map(),
    );

    const tools = (server as unknown as McpServerInternals)._registeredTools;
    expect(tools.create_audit_log).toBeDefined();
  });
});
