import { Hono } from 'hono';

import type { StorageService } from './service';

export function createStorageRoutes(service: StorageService): Hono {
  const routes = new Hono();

  // POST /api/storage/:bucket — upload a file
  routes.post('/:bucket', async (c) => {
    const bucketName = c.req.param('bucket');
    const bucket = service.bucket(bucketName);

    const body = await c.req.parseBody();
    const file = body['file'];

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'Missing file in request body' }, 400);
    }

    const data = new Uint8Array(await file.arrayBuffer());
    const key = (body['key'] as string) || file.name;
    const contentType = file.type || 'application/octet-stream';

    const obj = await bucket.upload(key, data, { contentType });
    return c.json(obj, 201);
  });

  // POST /api/storage/:bucket/confirm — confirm a presigned upload
  routes.post('/:bucket/confirm', async (c) => {
    const bucketName = c.req.param('bucket');
    const bucket = service.bucket(bucketName);
    const { key } = await c.req.json<{ key: string }>();

    const meta = await bucket.metadata(key);
    if (meta) {
      return c.json(meta);
    }

    return c.json({ error: 'Object not found' }, 404);
  });

  // GET /api/storage/:bucket — list objects
  routes.get('/:bucket', async (c) => {
    const bucketName = c.req.param('bucket');
    const bucket = service.bucket(bucketName);

    const prefix = c.req.query('prefix');
    const cursor = c.req.query('cursor');
    const limit = c.req.query('limit');

    const result = await bucket.list({
      prefix: prefix || undefined,
      cursor: cursor || undefined,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
    });

    return c.json(result);
  });

  // GET /api/storage/:bucket/:key{.+} — download / proxy a file
  routes.get('/:bucket/:key{.+}', async (c) => {
    const bucketName = c.req.param('bucket');
    const key = c.req.param('key');
    const bucket = service.bucket(bucketName);

    const data = await bucket.download(key);
    const meta = await bucket.metadata(key);
    const contentType = meta?.contentType ?? 'application/octet-stream';

    return new Response(data, {
      headers: { 'content-type': contentType },
    });
  });

  return routes;
}
