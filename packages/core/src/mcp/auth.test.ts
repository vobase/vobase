import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';

import { createDatabase } from '../db/client';
import { createMcpHandler } from './server';
import { auditLog } from '../modules/audit/schema';
import type { VobaseModule } from '../module';

const MODULES_WITH_SCHEMA: VobaseModule[] = [
  {
    name: 'audit',
    schema: { auditLog },
    routes: new Hono(),
  },
];

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

async function postMcp(
  handler: (req: Request) => Promise<Response>,
  payload: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const request = new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(payload),
  });

  const response = await handler(request);
  const body = (await response.json()) as Record<string, unknown>;
  return { response, body };
}

describe('MCP API key auth', () => {
  it('allows unauthenticated access to discovery tools', async () => {
    const handler = createMcpHandler({
      db: createTestDb(),
      modules: MODULES_WITH_SCHEMA,
      verifyApiKey: async () => null,
    });

    const { response, body } = await postMcp(handler, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });

    const tools = (
      (body.result as { tools?: Array<{ name: string }> }).tools ?? []
    ).map((t) => t.name);

    expect(response.status).toBe(200);
    expect(tools).toContain('list_modules');
    expect(tools).toContain('view_logs');
    // CRUD tools should NOT be present without auth
    expect(tools).not.toContain('list_audit_log');
    expect(tools).not.toContain('create_audit_log');
  });

  it('exposes CRUD tools when valid API key is provided', async () => {
    const handler = createMcpHandler({
      db: createTestDb(),
      modules: MODULES_WITH_SCHEMA,
      verifyApiKey: async (key) =>
        key === 'valid-key' ? { userId: 'u1' } : null,
    });

    const { response, body } = await postMcp(
      handler,
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { authorization: 'Bearer valid-key' },
    );

    const tools = (
      (body.result as { tools?: Array<{ name: string }> }).tools ?? []
    ).map((t) => t.name);

    expect(response.status).toBe(200);
    // Discovery tools present
    expect(tools).toContain('list_modules');
    // CRUD tools present when authenticated
    expect(tools).toContain('list_audit_log');
    expect(tools).toContain('get_audit_log');
    expect(tools).toContain('create_audit_log');
    expect(tools).toContain('update_audit_log');
    expect(tools).toContain('delete_audit_log');
  });

  it('does not expose CRUD tools with invalid API key', async () => {
    const handler = createMcpHandler({
      db: createTestDb(),
      modules: MODULES_WITH_SCHEMA,
      verifyApiKey: async () => null,
    });

    const { response, body } = await postMcp(
      handler,
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { authorization: 'Bearer bad-key' },
    );

    const tools = (
      (body.result as { tools?: Array<{ name: string }> }).tools ?? []
    ).map((t) => t.name);

    expect(response.status).toBe(200);
    expect(tools).toContain('list_modules');
    expect(tools).not.toContain('list_audit_log');
  });
});
