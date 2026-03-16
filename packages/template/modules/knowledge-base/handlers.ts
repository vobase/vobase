import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { getCtx, notFound, unauthorized } from '@vobase/core';
import type { IntegrationsService, VobaseDb } from '@vobase/core';

import type { DocumentSource } from './connectors/types';
import { kbChunks, kbDocuments, kbSources, kbSyncLogs } from './schema';

async function syncSource(
  db: VobaseDb,
  integrations: IntegrationsService,
  source: { id: string; type: string; config: string | null },
) {
  // Create sync log
  const [log] = await db
    .insert(kbSyncLogs)
    .values({
      sourceId: source.id,
      status: 'running',
    })
    .returning();

  try {
    let connector: DocumentSource;
    const config = source.config ? JSON.parse(source.config) : {};

    if (source.type === 'crawl') {
      const { createCrawlConnector } = await import('./connectors/crawl');
      connector = createCrawlConnector(config);
    } else if (source.type === 'google-drive') {
      const { createGoogleDriveConnector } = await import('./connectors/google-drive');
      if (!config.integrationId) throw new Error('Google Drive source missing integrationId');
      connector = createGoogleDriveConnector(config, integrations, config.integrationId);
    } else if (source.type === 'sharepoint') {
      const { createSharePointConnector } = await import('./connectors/sharepoint');
      if (!config.integrationId) throw new Error('SharePoint source missing integrationId');
      connector = createSharePointConnector(config, integrations, config.integrationId);
    } else {
      throw new Error(`Unknown source type: ${source.type}`);
    }

    let processed = 0;
    const { processDocument } = await import('./lib/pipeline');

    for await (const doc of connector.listDocuments()) {
      // Create document record
      const [docRecord] = await db
        .insert(kbDocuments)
        .values({
          title: doc.title,
          sourceType: source.type,
          sourceId: source.id,
          sourceUrl: doc.sourceUrl,
          mimeType: doc.mimeType,
        })
        .returning();

      // Fetch and process content
      const content = await connector.fetchDocument(doc.externalId);
      await processDocument(db, docRecord.id, content.text);
      processed++;
    }

    // Update sync log
    await db
      .update(kbSyncLogs)
      .set({
        status: 'completed',
        documentsProcessed: processed,
        completedAt: new Date(),
      })
      .where(eq(kbSyncLogs.id, log.id));

    // Update source status
    await db
      .update(kbSources)
      .set({
        status: 'idle',
        lastSyncAt: new Date(),
      })
      .where(eq(kbSources.id, source.id));
  } catch (error) {
    await db
      .update(kbSyncLogs)
      .set({
        status: 'error',
        errors: JSON.stringify({
          message: error instanceof Error ? error.message : String(error),
        }),
        completedAt: new Date(),
      })
      .where(eq(kbSyncLogs.id, log.id));

    await db.update(kbSources).set({ status: 'error' }).where(eq(kbSources.id, source.id));
  }
}

export const knowledgeBaseRoutes = new Hono();

// Auth guard: require authenticated user for all KB routes (except OAuth callbacks)
knowledgeBaseRoutes.use('*', async (c, next) => {
  const path = c.req.path;
  // OAuth callbacks come from external providers — skip auth
  if (path.includes('/oauth/')) return next();
  const ctx = getCtx(c);
  if (!ctx.user) throw unauthorized('Authentication required');
  return next();
});

// Documents — accepts multipart/form-data with a 'file' field
knowledgeBaseRoutes.post('/documents', async (c) => {
  const ctx = getCtx(c);
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) {
    return c.json({ error: 'Missing file field in form data' }, 400);
  }

  // 1. Insert document with pending status
  const [doc] = await ctx.db.insert(kbDocuments).values({
    title: file.name,
    sourceType: 'upload',
    mimeType: file.type || 'text/plain',
  }).returning();

  // 2. Write file to temp location for async job processing
  const tmpDir = `${process.cwd()}/data/tmp`;
  const { mkdirSync } = await import('node:fs');
  mkdirSync(tmpDir, { recursive: true });
  const tmpPath = `${tmpDir}/${doc.id}-${file.name}`;
  await Bun.write(tmpPath, await file.arrayBuffer());

  // 3. Enqueue processing job (extraction + chunking + embedding happen async)
  await ctx.scheduler.add('knowledge-base:process-document', {
    documentId: doc.id,
    filePath: tmpPath,
    mimeType: file.type || 'text/plain',
  });

  return c.json(doc, 201);
});

knowledgeBaseRoutes.get('/documents', async (c) => {
  const ctx = getCtx(c);
  const docs = await ctx.db.select().from(kbDocuments).orderBy(desc(kbDocuments.createdAt));
  return c.json(docs);
});

knowledgeBaseRoutes.get('/documents/:id', async (c) => {
  const ctx = getCtx(c);
  const doc = await ctx.db.select().from(kbDocuments).where(eq(kbDocuments.id, c.req.param('id'))).get();
  if (!doc) throw notFound('Document not found');
  const chunks = await ctx.db.select().from(kbChunks).where(eq(kbChunks.documentId, doc.id)).orderBy(kbChunks.chunkIndex);
  return c.json({ ...doc, chunks });
});

knowledgeBaseRoutes.delete('/documents/:id', async (c) => {
  const ctx = getCtx(c);
  const id = c.req.param('id');
  const chunks = await ctx.db.select({ rowId: kbChunks.rowId }).from(kbChunks).where(eq(kbChunks.documentId, id));
  const db = ctx.db.$client;
  for (const chunk of chunks) {
    db.run(`DELETE FROM kb_embeddings WHERE rowid = ?`, [chunk.rowId]);
    db.run(`DELETE FROM kb_chunks_fts WHERE rowid = ?`, [chunk.rowId]);
  }
  await ctx.db.delete(kbChunks).where(eq(kbChunks.documentId, id));
  await ctx.db.delete(kbDocuments).where(eq(kbDocuments.id, id));
  return c.json({ success: true });
});

// Search
knowledgeBaseRoutes.post('/search', async (c) => {
  const ctx = getCtx(c);
  const body = await c.req.json();
  const { extractIntent } = await import('./search-config');
  const { hybridSearch } = await import('./lib/search');

  // Strip intent signals (e.g. "recent", "latest") before search
  const { cleanQuery, sortHint } = extractIntent(body.query);

  const results = await hybridSearch(ctx.db, cleanQuery, {
    limit: body.limit,
    vectorWeight: body.vectorWeight,
    keywordWeight: body.keywordWeight,
    sourceIds: body.sourceIds,
    sortHint,
  });
  return c.json({ query: body.query, results });
});

// Suggestions for autocomplete (document titles)
knowledgeBaseRoutes.get('/suggestions', async (c) => {
  const ctx = getCtx(c);
  const docs = await ctx.db
    .select({ title: kbDocuments.title })
    .from(kbDocuments)
    .orderBy(desc(kbDocuments.createdAt))
    .limit(200);
  const suggestions = docs.map((d) => d.title).filter(Boolean);
  return c.json({ suggestions });
});

// Sources CRUD
knowledgeBaseRoutes.post('/sources', async (c) => {
  const ctx = getCtx(c);
  const body = await c.req.json();
  const [source] = await ctx.db.insert(kbSources).values({
    name: body.name,
    type: body.type,
    config: body.config ? JSON.stringify(body.config) : null,
    syncSchedule: body.syncSchedule,
  }).returning();
  return c.json(source, 201);
});

knowledgeBaseRoutes.get('/sources', async (c) => {
  const ctx = getCtx(c);
  const sources = await ctx.db.select().from(kbSources).orderBy(desc(kbSources.createdAt));
  return c.json(sources);
});

knowledgeBaseRoutes.put('/sources/:id', async (c) => {
  const ctx = getCtx(c);
  const body = await c.req.json();
  const [source] = await ctx.db.update(kbSources)
    .set({
      name: body.name,
      type: body.type,
      config: body.config ? JSON.stringify(body.config) : undefined,
      syncSchedule: body.syncSchedule,
    })
    .where(eq(kbSources.id, c.req.param('id')))
    .returning();
  if (!source) throw notFound('Source not found');
  return c.json(source);
});

knowledgeBaseRoutes.delete('/sources/:id', async (c) => {
  const ctx = getCtx(c);
  const id = c.req.param('id');
  const docs = await ctx.db.select({ id: kbDocuments.id }).from(kbDocuments).where(eq(kbDocuments.sourceId, id));
  for (const doc of docs) {
    const chunks = await ctx.db.select({ rowId: kbChunks.rowId }).from(kbChunks).where(eq(kbChunks.documentId, doc.id));
    const db = ctx.db.$client;
    for (const chunk of chunks) {
      db.run(`DELETE FROM kb_embeddings WHERE rowid = ?`, [chunk.rowId]);
      db.run(`DELETE FROM kb_chunks_fts WHERE rowid = ?`, [chunk.rowId]);
    }
    await ctx.db.delete(kbChunks).where(eq(kbChunks.documentId, doc.id));
  }
  await ctx.db.delete(kbDocuments).where(eq(kbDocuments.sourceId, id));
  await ctx.db.delete(kbSources).where(eq(kbSources.id, id));
  return c.json({ success: true });
});

// Sync trigger + logs
knowledgeBaseRoutes.post('/sources/:id/sync', async (c) => {
  const ctx = getCtx(c);
  const sourceId = c.req.param('id');
  const source = await ctx.db.select().from(kbSources).where(eq(kbSources.id, sourceId)).get();
  if (!source) throw notFound('Source not found');

  // Trigger sync in background (fire and forget)
  syncSource(ctx.db, ctx.integrations, source).catch(console.error);
  return c.json({ message: 'Sync started' });
});

knowledgeBaseRoutes.get('/sources/:id/logs', async (c) => {
  const ctx = getCtx(c);
  const logs = await ctx.db.select().from(kbSyncLogs)
    .where(eq(kbSyncLogs.sourceId, c.req.param('id')))
    .orderBy(desc(kbSyncLogs.startedAt));
  return c.json(logs);
});

// OAuth callbacks
knowledgeBaseRoutes.get('/oauth/google/callback', async (c) => {
  const ctx = getCtx(c);
  const code = c.req.query('code');
  const sourceId = c.req.query('state');
  if (!code || !sourceId) return c.text('Missing code or state', 400);

  // Look up the source to get its name for the integration label
  const source = await ctx.db.select().from(kbSources).where(eq(kbSources.id, sourceId)).get();
  const { exchangeGoogleCode } = await import('./connectors/google-drive');
  const integrationId = await exchangeGoogleCode(ctx.integrations, sourceId, code, {
    createdBy: ctx.user?.id,
    label: source?.name ?? `KB source ${sourceId}`,
  });

  // Store integrationId in source config
  const existingConfig = source?.config ? JSON.parse(source.config) : {};
  await ctx.db
    .update(kbSources)
    .set({ config: JSON.stringify({ ...existingConfig, integrationId }) })
    .where(eq(kbSources.id, sourceId));

  return c.redirect('/knowledge-base/sources');
});

knowledgeBaseRoutes.get('/oauth/microsoft/callback', async (c) => {
  const ctx = getCtx(c);
  const code = c.req.query('code');
  const sourceId = c.req.query('state');
  if (!code || !sourceId) return c.text('Missing code or state', 400);

  // Look up the source to get its name for the integration label
  const source = await ctx.db.select().from(kbSources).where(eq(kbSources.id, sourceId)).get();
  const { exchangeSharePointCode } = await import('./connectors/sharepoint');
  const integrationId = await exchangeSharePointCode(ctx.integrations, sourceId, code, {
    createdBy: ctx.user?.id,
    label: source?.name ?? `KB source ${sourceId}`,
  });

  // Store integrationId in source config
  const existingConfig = source?.config ? JSON.parse(source.config) : {};
  await ctx.db
    .update(kbSources)
    .set({ config: JSON.stringify({ ...existingConfig, integrationId }) })
    .where(eq(kbSources.id, sourceId));

  return c.redirect('/knowledge-base/sources');
});

// OAuth auth URL generators
knowledgeBaseRoutes.get('/sources/:id/auth-url', async (c) => {
  const ctx = getCtx(c);
  const sourceId = c.req.param('id');
  const source = await ctx.db.select().from(kbSources).where(eq(kbSources.id, sourceId)).get();
  if (!source) throw notFound('Source not found');

  if (source.type === 'google-drive') {
    const { getGoogleAuthUrl } = await import('./connectors/google-drive');
    const url = await getGoogleAuthUrl(sourceId);
    return c.json({ url });
  }
  if (source.type === 'sharepoint') {
    const { getSharePointAuthUrl } = await import('./connectors/sharepoint');
    const url = getSharePointAuthUrl(sourceId);
    return c.json({ url });
  }
  return c.json({ error: 'Source type does not require OAuth' }, 400);
});

// Reindex
knowledgeBaseRoutes.post('/reindex', async (c) => {
  return c.json({ message: 'Reindex triggered' });
});
