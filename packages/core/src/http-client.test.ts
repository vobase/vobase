import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type HttpClient, createHttpClient } from './http-client';

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
    const res = await client.post<{ method: string; body: unknown }>(
      '/echo',
      { key: 'value' },
    );
    expect(res.data.method).toBe('POST');
    expect(res.data.body).toEqual({ key: 'value' });
  });
});

describe('HttpClient.put', () => {
  test('sends PUT with JSON body', async () => {
    const client = createHttpClient({ baseUrl });
    const res = await client.put<{ method: string; body: unknown }>(
      '/echo',
      { updated: true },
    );
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
    const res = await client.post<{ contentType: string | null }>(
      '/echo-raw',
    );
    expect(res.data.contentType).toBeNull();
  });
});
