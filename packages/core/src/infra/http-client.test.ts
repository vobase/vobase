import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { createHttpClient } from './http-client';

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === '/json') {
        return Response.json({ message: 'hello' });
      }

      if (url.pathname === '/text') {
        return new Response('plain text', {
          headers: { 'content-type': 'text/plain' },
        });
      }

      if (url.pathname === '/no-content') {
        return new Response(null, { status: 204 });
      }

      if (url.pathname === '/echo') {
        return req.json().then((body) =>
          Response.json({
            method: req.method,
            body,
            contentType: req.headers.get('content-type'),
          }),
        );
      }

      if (url.pathname === '/echo-raw') {
        const text = await req.text();
        return Response.json({
          method: req.method,
          body: text,
          contentType: req.headers.get('content-type'),
        });
      }

      if (url.pathname === '/headers') {
        return Response.json({
          custom: req.headers.get('x-custom'),
        });
      }

      if (url.pathname === '/slow') {
        return new Promise((resolve) =>
          setTimeout(() => resolve(Response.json({ done: true })), 5000),
        );
      }

      if (url.pathname === '/status/404') {
        return Response.json({ error: 'not found' }, { status: 404 });
      }

      if (url.pathname === '/status/500') {
        return Response.json({ error: 'server error' }, { status: 500 });
      }

      return new Response('not found', { status: 404 });
    },
  });

  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

/** Helper: create a local server with a custom handler, returns { baseUrl, stop } */
function createTestServer(
  handler: (req: Request) => Response | Promise<Response>,
) {
  const s = Bun.serve({ port: 0, fetch: handler });
  return { baseUrl: `http://localhost:${s.port}`, stop: () => s.stop(true) };
}

describe('createHttpClient', () => {
  test('returns an object with fetch, get, post, put, delete methods', () => {
    const client = createHttpClient();
    expect(typeof client.fetch).toBe('function');
    expect(typeof client.get).toBe('function');
    expect(typeof client.post).toBe('function');
    expect(typeof client.put).toBe('function');
    expect(typeof client.delete).toBe('function');
  });
});

describe('HttpClient.fetch', () => {
  test('makes a GET request and parses JSON response', async () => {
    const client = createHttpClient({ baseUrl });
    const res = await client.fetch('/json');
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ message: 'hello' });
    expect(res.raw).toBeInstanceOf(Response);
    expect(res.headers).toBeInstanceOf(Headers);
  });

  test('parses text response when content-type is not JSON', async () => {
    const client = createHttpClient({ baseUrl });
    const res = await client.fetch('/text');
    expect(res.ok).toBe(true);
    expect(res.data).toBe('plain text');
  });

  test('handles empty body (204 no content)', async () => {
    const client = createHttpClient({ baseUrl });
    const res = await client.fetch('/no-content');
    expect(res.ok).toBe(true);
    expect(res.status).toBe(204);
    expect(res.data).toBeNull();
  });

  test('sends JSON body with POST method', async () => {
    const client = createHttpClient({ baseUrl });
    const res = await client.fetch<{
      method: string;
      body: unknown;
      contentType: string;
    }>('/echo', {
      method: 'POST',
      body: { foo: 'bar' },
    });
    expect(res.data.method).toBe('POST');
    expect(res.data.body).toEqual({ foo: 'bar' });
    expect(res.data.contentType).toBe('application/json');
  });

  test('sends custom headers', async () => {
    const client = createHttpClient({ baseUrl });
    const res = await client.fetch<{ custom: string }>('/headers', {
      headers: { 'x-custom': 'test-value' },
    });
    expect(res.data.custom).toBe('test-value');
  });

  test('returns ok=false for non-2xx status', async () => {
    const client = createHttpClient({ baseUrl });
    const res = await client.fetch('/status/404');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(res.data).toEqual({ error: 'not found' });
  });

  test('works with absolute URL ignoring baseUrl', async () => {
    const client = createHttpClient({ baseUrl: 'http://wrong-host:9999' });
    const res = await client.fetch(`${baseUrl}/json`);
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ message: 'hello' });
  });
});

describe('HttpClient.get', () => {
  test('makes a GET request', async () => {
    const client = createHttpClient({ baseUrl });
    const res = await client.get('/json');
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ message: 'hello' });
  });

  test('passes custom headers', async () => {
    const client = createHttpClient({ baseUrl });
    const res = await client.get<{ custom: string }>('/headers', {
      headers: { 'x-custom': 'from-get' },
    });
    expect(res.data.custom).toBe('from-get');
  });
});

describe('HttpClient.post', () => {
  test('sends POST with JSON body', async () => {
    const client = createHttpClient({ baseUrl });
    const res = await client.post<{ method: string; body: unknown }>('/echo', {
      key: 'value',
    });
    expect(res.data.method).toBe('POST');
    expect(res.data.body).toEqual({ key: 'value' });
  });
});

describe('HttpClient.put', () => {
  test('sends PUT with JSON body', async () => {
    const client = createHttpClient({ baseUrl });
    const res = await client.put<{ method: string; body: unknown }>('/echo', {
      updated: true,
    });
    expect(res.data.method).toBe('PUT');
    expect(res.data.body).toEqual({ updated: true });
  });
});

describe('HttpClient.delete', () => {
  test('sends DELETE request', async () => {
    const client = createHttpClient({ baseUrl });
    const res = await client.delete('/json');
    expect(res.ok).toBe(true);
  });
});

describe('timeout', () => {
  test('aborts request after timeout', async () => {
    const client = createHttpClient({ baseUrl, timeout: 100 });
    await expect(client.get('/slow')).rejects.toThrow();
  });

  test('per-request timeout overrides default', async () => {
    const client = createHttpClient({ baseUrl, timeout: 30_000 });
    await expect(client.get('/slow', { timeout: 100 })).rejects.toThrow();
  });
});

describe('baseUrl', () => {
  test('prepends baseUrl to relative paths', async () => {
    const client = createHttpClient({ baseUrl });
    const res = await client.get('/json');
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ message: 'hello' });
  });

  test('works without baseUrl using full URL', async () => {
    const client = createHttpClient();
    const res = await client.get(`${baseUrl}/json`);
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ message: 'hello' });
  });
});

describe('retry logic', () => {
  test('retries GET on 5xx and eventually succeeds', async () => {
    let attempts = 0;
    const ts = createTestServer(() => {
      attempts++;
      if (attempts < 3) {
        return Response.json({ error: 'fail' }, { status: 500 });
      }
      return Response.json({ ok: true });
    });

    try {
      const client = createHttpClient({
        baseUrl: ts.baseUrl,
        retries: 3,
        retryDelay: 10,
      });
      const res = await client.get('/test');
      expect(res.ok).toBe(true);
      expect(res.data).toEqual({ ok: true });
      expect(attempts).toBe(3);
    } finally {
      ts.stop();
    }
  });

  test('returns last 5xx response after exhausting retries for GET', async () => {
    let attempts = 0;
    const ts = createTestServer(() => {
      attempts++;
      return Response.json({ error: `fail-${attempts}` }, { status: 503 });
    });

    try {
      const client = createHttpClient({
        baseUrl: ts.baseUrl,
        retries: 2,
        retryDelay: 10,
      });
      const res = await client.get('/test');
      expect(res.ok).toBe(false);
      expect(res.status).toBe(503);
      expect(attempts).toBe(3); // 1 initial + 2 retries
    } finally {
      ts.stop();
    }
  });

  test('retries POST on network error and eventually succeeds', async () => {
    // First, grab a port by starting then stopping a server
    const tempServer = Bun.serve({ port: 0, fetch: () => new Response('') });
    const port = tempServer.port;
    tempServer.stop(true);

    // Client will hit a closed port (network error) on first attempts
    const client = createHttpClient({
      baseUrl: `http://localhost:${port}`,
      retries: 3,
      retryDelay: 10,
      timeout: 500,
    });

    // Start the real server on the same port after a short delay
    let realServer: ReturnType<typeof Bun.serve> | undefined;
    setTimeout(() => {
      realServer = Bun.serve({
        port,
        fetch: (req) => Response.json({ method: req.method, posted: true }),
      });
    }, 30);

    try {
      const res = await client.post('/test', { data: 1 });
      expect(res.ok).toBe(true);
      expect(res.data).toEqual({ method: 'POST', posted: true });
    } finally {
      realServer?.stop(true);
    }
  });

  test('throws last network error after exhausting retries', async () => {
    // Use a port with nothing listening
    const tempServer = Bun.serve({ port: 0, fetch: () => new Response('') });
    const port = tempServer.port;
    tempServer.stop(true);

    const client = createHttpClient({
      baseUrl: `http://localhost:${port}`,
      retries: 2,
      retryDelay: 10,
      timeout: 500,
    });

    await expect(client.post('/test', { data: 1 })).rejects.toThrow();
  });

  test('does NOT retry POST on 5xx (returns immediately)', async () => {
    let attempts = 0;
    const ts = createTestServer(() => {
      attempts++;
      return Response.json({ error: 'server error' }, { status: 500 });
    });

    try {
      const client = createHttpClient({
        baseUrl: ts.baseUrl,
        retries: 3,
        retryDelay: 10,
      });
      const res = await client.post('/test', { data: 1 });
      expect(res.ok).toBe(false);
      expect(res.status).toBe(500);
      expect(attempts).toBe(1); // No retries
    } finally {
      ts.stop();
    }
  });

  test('per-request retries override works', async () => {
    let attempts = 0;
    const ts = createTestServer(() => {
      attempts++;
      if (attempts < 4) {
        return Response.json({ error: 'fail' }, { status: 500 });
      }
      return Response.json({ ok: true });
    });

    try {
      // Client default is 0 retries, but per-request overrides to 3
      const client = createHttpClient({
        baseUrl: ts.baseUrl,
        retries: 0,
        retryDelay: 10,
      });
      const res = await client.get('/test', { retries: 3 });
      expect(res.ok).toBe(true);
      expect(res.data).toEqual({ ok: true });
      expect(attempts).toBe(4);
    } finally {
      ts.stop();
    }
  });

  test('no retries when retries=0 (default)', async () => {
    let attempts = 0;
    const ts = createTestServer(() => {
      attempts++;
      return Response.json({ error: 'fail' }, { status: 500 });
    });

    try {
      const client = createHttpClient({ baseUrl: ts.baseUrl, retryDelay: 10 });
      const res = await client.get('/test');
      expect(res.ok).toBe(false);
      expect(res.status).toBe(500);
      expect(attempts).toBe(1);
    } finally {
      ts.stop();
    }
  });
});

describe('circuit breaker integration', () => {
  test('HttpClient with circuit breaker opens after threshold failures', async () => {
    const ts = createTestServer(() => {
      return Response.json({ error: 'fail' }, { status: 500 });
    });

    try {
      const client = createHttpClient({
        baseUrl: ts.baseUrl,
        circuitBreaker: { threshold: 3, resetTimeout: 5000 },
      });

      // 3 failures should open the circuit
      await client.get('/test');
      await client.get('/test');
      await client.get('/test');

      // Now the circuit should be open
      await expect(client.get('/test')).rejects.toThrow(
        'Circuit breaker is open',
      );
    } finally {
      ts.stop();
    }
  });

  test('HttpClient throws when circuit is open', async () => {
    const ts = createTestServer(() => {
      return Response.json({ error: 'fail' }, { status: 500 });
    });

    try {
      const client = createHttpClient({
        baseUrl: ts.baseUrl,
        circuitBreaker: { threshold: 2, resetTimeout: 5000 },
      });

      // Trip the breaker
      await client.post('/test', { data: 1 });
      await client.post('/test', { data: 2 });

      // All methods should be rejected
      await expect(client.get('/test')).rejects.toThrow(
        'Circuit breaker is open',
      );
      await expect(client.post('/test', {})).rejects.toThrow(
        'Circuit breaker is open',
      );
      await expect(client.put('/test', {})).rejects.toThrow(
        'Circuit breaker is open',
      );
      await expect(client.delete('/test')).rejects.toThrow(
        'Circuit breaker is open',
      );
    } finally {
      ts.stop();
    }
  });
});

describe('body serialization', () => {
  test('passes string body through without JSON.stringify', async () => {
    const client = createHttpClient({ baseUrl });
    const res = await client.post<{ body: string; contentType: string | null }>(
      '/echo-raw',
      'raw string body',
    );
    expect(res.data.body).toBe('raw string body');
    expect(res.data.contentType).not.toBe('application/json');
  });

  test('passes Blob body through without JSON.stringify', async () => {
    const client = createHttpClient({ baseUrl });
    const blob = new Blob(['blob content'], { type: 'text/plain' });
    const res = await client.post<{ body: string; contentType: string | null }>(
      '/echo-raw',
      blob,
    );
    expect(res.data.body).toBe('blob content');
  });

  test('passes URLSearchParams body through without JSON.stringify', async () => {
    const client = createHttpClient({ baseUrl });
    const params = new URLSearchParams({ key: 'value' });
    const res = await client.post<{ body: string; contentType: string | null }>(
      '/echo-raw',
      params,
    );
    expect(res.data.body).toBe('key=value');
    expect(res.data.contentType).not.toBe('application/json');
  });

  test('JSON.stringifies plain objects and sets content-type', async () => {
    const client = createHttpClient({ baseUrl });
    const res = await client.post<{
      body: unknown;
      contentType: string;
    }>('/echo', { key: 'value' });
    expect(res.data.body).toEqual({ key: 'value' });
    expect(res.data.contentType).toBe('application/json');
  });

  test('post with no body does not set content-type', async () => {
    const client = createHttpClient({ baseUrl });
    const res = await client.post<{ contentType: string | null }>('/echo-raw');
    expect(res.data.contentType).toBeNull();
  });
});
