import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';

import { createDatabase } from './db/client';
import { createMcpHandler } from './mcp';
import type { VobaseModule } from './module';

const MODULES: VobaseModule[] = [
  {
    name: 'billing',
    schema: { customers: {}, invoices: {} },
    routes: new Hono(),
  },
  {
    name: 'catalog',
    schema: { invoices: {}, products: {} },
    routes: new Hono(),
  },
];

function createTestDb() {
  const db = createDatabase(':memory:');
  db.$client.run(`
    CREATE TABLE _audit_log (
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
  payload: Record<string, unknown>
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const request = new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(payload),
  });

  const response = await handler(request);
  const body = (await response.json()) as Record<string, unknown>;
  return { response, body };
}

function parseStructuredToolResult(body: Record<string, unknown>): Record<string, unknown> {
  const result = body.result as {
    structuredContent?: Record<string, unknown>;
    content?: Array<{ type: string; text?: string }>;
  };

  if (result.structuredContent) {
    return result.structuredContent;
  }

  const text = result.content?.find((item) => item.type === 'text')?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

describe('createMcpHandler()', () => {
  it('creates a request handler function', () => {
    const handler = createMcpHandler({ db: createTestDb(), modules: MODULES });
    expect(typeof handler).toBe('function');
  });

  it('returns all four read-only tools for tools/list', async () => {
    const handler = createMcpHandler({ db: createTestDb(), modules: MODULES });

    const { response, body } = await postMcp(handler, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });

    const tools = ((body.result as { tools?: Array<{ name: string }> }).tools ?? []).map(
      (tool) => tool.name
    );

    expect(response.status).toBe(200);
    expect(tools).toEqual(['list_modules', 'read_module', 'get_schema', 'view_logs']);
  });

  it('list_modules returns registered module names', async () => {
    const handler = createMcpHandler({ db: createTestDb(), modules: MODULES });

    const { response, body } = await postMcp(handler, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'list_modules',
        arguments: {},
      },
    });

    expect(response.status).toBe(200);
    expect(parseStructuredToolResult(body)).toEqual({
      modules: [{ name: 'billing' }, { name: 'catalog' }],
    });
  });

  it('get_schema returns table names across modules', async () => {
    const handler = createMcpHandler({ db: createTestDb(), modules: MODULES });

    const { response, body } = await postMcp(handler, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'get_schema',
        arguments: {},
      },
    });

    expect(response.status).toBe(200);
    expect(parseStructuredToolResult(body)).toEqual({
      tables: ['customers', 'invoices', 'products'],
    });
  });

  it('does not expose write tools', async () => {
    const handler = createMcpHandler({ db: createTestDb(), modules: MODULES });

    const { body } = await postMcp(handler, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/list',
    });

    const toolNames = ((body.result as { tools?: Array<{ name: string }> }).tools ?? []).map(
      (tool) => tool.name
    );

    expect(toolNames).not.toContain('deploy_module');
    expect(toolNames).not.toContain('install_package');
  });
});
