import { describe, expect, test } from 'bun:test';

import { createAiMcpHandler } from './server';

describe('createAiMcpHandler', () => {
  test('returns a function', () => {
    // Pass a minimal db mock — the handler only uses db when a tool is called
    const handler = createAiMcpHandler({} as any);
    expect(typeof handler).toBe('function');
  });

  test('handler returns a Response for POST requests', async () => {
    const handler = createAiMcpHandler({} as any);

    // Send a valid JSON-RPC initialize request
    const req = new Request('http://localhost/api/ai/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '0.1.0' },
        },
      }),
    });

    const response = await handler(req);
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBeLessThan(500);
  });
});
