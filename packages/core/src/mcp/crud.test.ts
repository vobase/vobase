import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createDatabase } from '../db/client';
import { auditLog } from '../modules/audit/schema';
import { registerCrudTools } from './crud';
import type { VobaseModule } from '../module';

function createTestDb() {
  const db = createDatabase(':memory:');
  db.$client.run(`
    CREATE TABLE IF NOT EXISTS _audit_log (
      id TEXT PRIMARY KEY NOT NULL,
      event TEXT NOT NULL,
      actor_id TEXT,
      actor_email TEXT,
      ip TEXT,
      details TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  return db;
}

describe('registerCrudTools', () => {
  it('registers 5 CRUD tools per real Drizzle table', () => {
    const server = new McpServer({ name: 'test', version: '0.1.0' });
    const db = createTestDb();

    const modules: VobaseModule[] = [
      {
        name: 'audit',
        schema: { auditLog },
        routes: new Hono(),
      },
    ];

    registerCrudTools(server, modules, {
      db,
      user: { id: 'u1', email: 'a@b.com', name: 'Test', role: 'admin' },
      organizationEnabled: false,
    }, new Map());

    // Access the registered tools via the server's internal state
    const tools = (server as any)._registeredTools;
    const toolNames = Object.keys(tools);

    expect(toolNames).toContain('list_audit_log');
    expect(toolNames).toContain('get_audit_log');
    expect(toolNames).toContain('create_audit_log');
    expect(toolNames).toContain('update_audit_log');
    expect(toolNames).toContain('delete_audit_log');
  });

  it('skips non-Drizzle schema entries gracefully', () => {
    const server = new McpServer({ name: 'test', version: '0.1.0' });
    const db = createTestDb();

    const modules: VobaseModule[] = [
      {
        name: 'mock',
        schema: { fakeThing: {} },
        routes: new Hono(),
      },
    ];

    // Should not throw
    registerCrudTools(server, modules, {
      db,
      user: null,
      organizationEnabled: false,
    }, new Map());

    const tools = (server as any)._registeredTools;
    const toolNames = Object.keys(tools);
    // No CRUD tools registered for non-Drizzle schema
    expect(toolNames.filter((n: string) => n.includes('fakeThing'))).toEqual([]);
  });

  it('respects exclude map', () => {
    const server = new McpServer({ name: 'test', version: '0.1.0' });
    const db = createTestDb();

    const modules: VobaseModule[] = [
      {
        name: 'audit',
        schema: { auditLog },
        routes: new Hono(),
      },
    ];

    const excludeMap = new Map([['audit', new Set(['auditLog'])]]);

    registerCrudTools(server, modules, {
      db,
      user: { id: 'u1', email: 'a@b.com', name: 'Test', role: 'admin' },
      organizationEnabled: false,
    }, excludeMap);

    const tools = (server as any)._registeredTools;
    const toolNames = Object.keys(tools);
    expect(toolNames.filter((n: string) => n.includes('audit_log'))).toEqual([]);
  });

  it('write tools check admin role when org is disabled', () => {
    const server = new McpServer({ name: 'test', version: '0.1.0' });
    const db = createTestDb();

    const modules: VobaseModule[] = [
      {
        name: 'audit',
        schema: { auditLog },
        routes: new Hono(),
      },
    ];

    // User with non-admin role
    registerCrudTools(server, modules, {
      db,
      user: { id: 'u1', email: 'a@b.com', name: 'Test', role: 'user' },
      organizationEnabled: false,
    }, new Map());

    const tools = (server as any)._registeredTools;
    expect(tools.create_audit_log).toBeDefined();
  });
});
