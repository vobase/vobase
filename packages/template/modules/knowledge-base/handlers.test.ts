import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import type { VobaseDb } from '@vobase/core';
import { errorHandler } from '@vobase/core';
import { Hono } from 'hono';

import { createTestDb } from '../../lib/test-helpers';
import { knowledgeBaseRoutes } from './handlers';
import { kbDocuments, kbSources, kbSyncLogs } from './schema';

const BASE = 'http://localhost/api/knowledge-base';

const schedulerJobs: Array<{ name: string; data: unknown }> = [];

function createApp(
  db: VobaseDb,
  user: { id: string; email: string; name: string; role: string } | null = {
    id: 'user-1',
    email: 'test@test.com',
    name: 'Test',
    role: 'user',
  },
) {
  schedulerJobs.length = 0;
  const app = new Hono();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('db', db);
    c.set('user', user);
    c.set('scheduler', {
      add: async (name: string, data: unknown) => {
        schedulerJobs.push({ name, data });
      },
    } as never);
    c.set('storage', {
      bucket: () => ({
        upload: async () => {},
        download: async () => new Uint8Array(),
        delete: async () => {},
        exists: async () => false,
      }),
    } as never);
    c.set('channels', {} as never);
    c.set('http', {} as never);
    await next();
  });
  app.route('/api/knowledge-base', knowledgeBaseRoutes);
  return app;
}

describe('Knowledge Base Routes', () => {
  let pglite: PGlite;
  let db: VobaseDb;
  let app: Hono;

  beforeEach(async () => {
    const testDb = await createTestDb({ withVec: true });
    pglite = testDb.pglite;
    db = testDb.db;
    app = createApp(db);
  });

  // Singleton PGlite — never close; process exit handles cleanup

  describe('Auth', () => {
    it('returns 401 for unauthenticated requests', async () => {
      const unauthed = createApp(db, null);
      const res = await unauthed.request(`${BASE}/documents`);
      expect(res.status).toBe(401);
    });
  });

  describe('Documents', () => {
    it('POST /documents creates a document from multipart upload and enqueues job', async () => {
      const formData = new FormData();
      formData.append(
        'file',
        new File(['Hello world'], 'test.txt', { type: 'text/plain' }),
      );

      const res = await app.request(`${BASE}/documents`, {
        method: 'POST',
        body: formData,
      });

      expect(res.status).toBe(201);
      const doc = await res.json();
      expect(doc.title).toBe('test.txt');
      expect(doc.sourceType).toBe('upload');
      expect(doc.status).toBe('pending');
      expect(doc.mimeType).toContain('text/plain');

      // Verify job was enqueued
      expect(schedulerJobs).toHaveLength(1);
      expect(schedulerJobs[0].name).toBe('knowledge-base:process-document');
      const jobData = schedulerJobs[0].data as {
        documentId: string;
        storageKey: string;
        mimeType: string;
      };
      expect(jobData.documentId).toBe(doc.id);
      expect(jobData.mimeType).toContain('text/plain');
      expect(jobData.storageKey).toContain(doc.id);
    });

    it('POST /documents returns 400 when no file provided', async () => {
      const res = await app.request(`${BASE}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'No File' }),
      });

      expect(res.status).toBe(400);
    });

    it('GET /documents lists documents', async () => {
      await db.insert(kbDocuments).values({
        id: 'doc-a',
        title: 'First',
        sourceType: 'upload',
        mimeType: 'text/plain',
      });
      await db.insert(kbDocuments).values({
        id: 'doc-b',
        title: 'Second',
        sourceType: 'upload',
        mimeType: 'text/plain',
      });

      const res = await app.request(`${BASE}/documents`);
      expect(res.status).toBe(200);
      const docs = await res.json();
      expect(docs).toHaveLength(2);
    });

    it('GET /documents/:id returns document with chunks array', async () => {
      await db.insert(kbDocuments).values({
        id: 'doc-get',
        title: 'Get Me',
        sourceType: 'upload',
        mimeType: 'text/plain',
      });

      const res = await app.request(`${BASE}/documents/doc-get`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.title).toBe('Get Me');
      expect(data.chunks).toEqual([]);
    });

    it('GET /documents/:id returns 404 for nonexistent document', async () => {
      const res = await app.request(`${BASE}/documents/nope`);
      expect(res.status).toBe(404);
    });

    it('DELETE /documents/:id removes document', async () => {
      await db.insert(kbDocuments).values({
        id: 'doc-del',
        title: 'Delete Me',
        sourceType: 'upload',
        mimeType: 'text/plain',
      });

      const res = await app.request(`${BASE}/documents/doc-del`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify it's gone
      const check = await app.request(`${BASE}/documents/doc-del`);
      expect(check.status).toBe(404);
    });
  });

  describe('Sources', () => {
    it('POST /sources creates a source', async () => {
      const res = await app.request(`${BASE}/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Crawl', type: 'crawl' }),
      });

      expect(res.status).toBe(201);
      const source = await res.json();
      expect(source.name).toBe('My Crawl');
      expect(source.type).toBe('crawl');
      expect(source.status).toBe('idle');
    });

    it('GET /sources lists sources', async () => {
      await db
        .insert(kbSources)
        .values({ id: 'src-1', name: 'Source A', type: 'crawl' });
      await db
        .insert(kbSources)
        .values({ id: 'src-2', name: 'Source B', type: 'google-drive' });

      const res = await app.request(`${BASE}/sources`);
      expect(res.status).toBe(200);
      const sources = await res.json();
      expect(sources).toHaveLength(2);
    });

    it('PUT /sources/:id updates a source', async () => {
      await db
        .insert(kbSources)
        .values({ id: 'src-upd', name: 'Old', type: 'crawl' });

      const res = await app.request(`${BASE}/sources/src-upd`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New',
          config: { url: 'https://example.com' },
        }),
      });

      expect(res.status).toBe(200);
      const source = await res.json();
      expect(source.name).toBe('New');
      expect(JSON.parse(source.config)).toEqual({ url: 'https://example.com' });
    });

    it('PUT /sources/:id returns 404 for nonexistent source', async () => {
      const res = await app.request(`${BASE}/sources/nope`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Whatever' }),
      });

      expect(res.status).toBe(404);
    });

    it('DELETE /sources/:id removes source and associated documents', async () => {
      await db
        .insert(kbSources)
        .values({ id: 'src-cascade', name: 'Cascade', type: 'crawl' });
      await db.insert(kbDocuments).values({
        id: 'doc-src-1',
        title: 'Source Doc',
        sourceType: 'crawl',
        sourceId: 'src-cascade',
        mimeType: 'text/plain',
      });

      const res = await app.request(`${BASE}/sources/src-cascade`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify source and doc are gone
      const srcRes = await app.request(`${BASE}/sources`);
      const sources = await srcRes.json();
      expect(sources).toHaveLength(0);

      const docRes = await app.request(`${BASE}/documents`);
      const docs = await docRes.json();
      expect(docs).toHaveLength(0);
    });
  });

  describe('Sync', () => {
    it('POST /sources/:id/sync returns sync started message', async () => {
      await db
        .insert(kbSources)
        .values({ id: 'src-sync', name: 'Sync Me', type: 'crawl' });

      const res = await app.request(`${BASE}/sources/src-sync/sync`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message).toBe('Sync started');
    });

    it('POST /sources/:id/sync returns 404 for nonexistent source', async () => {
      const res = await app.request(`${BASE}/sources/nope/sync`, {
        method: 'POST',
      });
      expect(res.status).toBe(404);
    });

    it('GET /sources/:id/logs returns sync logs', async () => {
      await db.insert(kbSources).values([
        { id: 'src-1', name: 'Source A', type: 'crawl' },
        { id: 'src-2', name: 'Source B', type: 'crawl' },
      ]);
      await db
        .insert(kbSyncLogs)
        .values({ id: 'log-a', sourceId: 'src-1', status: 'completed' });
      await db
        .insert(kbSyncLogs)
        .values({ id: 'log-b', sourceId: 'src-1', status: 'error' });
      await db
        .insert(kbSyncLogs)
        .values({ id: 'log-c', sourceId: 'src-2', status: 'completed' });

      const res = await app.request(`${BASE}/sources/src-1/logs`);
      expect(res.status).toBe(200);
      const logs = await res.json();
      expect(logs).toHaveLength(2);
    });
  });

  describe('Reindex', () => {
    it('POST /reindex returns message', async () => {
      const res = await app.request(`${BASE}/reindex`, { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message).toBe('Reindex triggered');
    });
  });
});
