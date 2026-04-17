import type { IntegrationsService, VobaseDb } from '@vobase/core';
import {
  conflict,
  getCtx,
  logger,
  notFound,
  unauthorized,
  validation,
} from '@vobase/core';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { embedChunks } from '../../lib/embeddings';
import { createCrawlConnector } from './connectors/crawl';
import {
  createGoogleDriveConnector,
  exchangeGoogleCode,
  getGoogleAuthUrl,
} from './connectors/google-drive';
import {
  createSharePointConnector,
  exchangeSharePointCode,
  getSharePointAuthUrl,
} from './connectors/sharepoint';
import type { DocumentSource } from './connectors/types';
import { KB_STORAGE_BUCKET } from './constants';
import { blockChunk } from './lib/chunker';
import { migrateExistingDocuments } from './lib/migrate-content';
import { processDocument } from './lib/pipeline';
import { markdownToPlate } from './lib/plate-deserialize';
import { diffPlateValue, isBlockRangeAffected } from './lib/plate-diff';
import type { PlateValue } from './lib/plate-types';
import { plateValueSchema } from './lib/plate-types';
import { hybridSearch } from './lib/search';
import { kbChunks, kbDocuments, kbSources, kbSyncLogs } from './schema';
import { extractIntent } from './search-config';

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
      connector = createCrawlConnector(config, integrations);
    } else if (source.type === 'google-drive') {
      if (!config.integrationId)
        throw new Error('Google Drive source missing integrationId');
      connector = createGoogleDriveConnector(
        config,
        integrations,
        config.integrationId,
      );
    } else if (source.type === 'sharepoint') {
      if (!config.integrationId)
        throw new Error('SharePoint source missing integrationId');
      connector = createSharePointConnector(
        config,
        integrations,
        config.integrationId,
      );
    } else {
      throw new Error(`Unknown source type: ${source.type}`);
    }

    let processed = 0;

    for await (const doc of connector.listDocuments()) {
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

      const content = await connector.fetchDocument(doc.externalId);
      const value: PlateValue = content.value ?? markdownToPlate(content.text);
      await processDocument(db, docRecord.id, value);
      processed++;
    }

    await db
      .update(kbSyncLogs)
      .set({
        status: 'completed',
        documentsProcessed: processed,
        completedAt: new Date(),
      })
      .where(eq(kbSyncLogs.id, log.id));

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

    await db
      .update(kbSources)
      .set({ status: 'error' })
      .where(eq(kbSources.id, source.id));
  }
}

export const knowledgeBaseRoutes = new Hono()
  // Auth guard: require authenticated user for all KB routes (except OAuth callbacks)
  .use('*', async (c, next) => {
    const path = c.req.path;
    // OAuth callbacks come from external providers — skip auth
    if (path.includes('/oauth/')) return next();
    const ctx = getCtx(c);
    if (!ctx.user) throw unauthorized('Authentication required');
    return next();
  })
  // Documents — accepts multipart/form-data with a 'file' field
  .post('/documents', async (c) => {
    const ctx = getCtx(c);
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) {
      return c.json({ error: 'Missing file field in form data' }, 400);
    }

    // 1. Insert document with pending status
    const [doc] = await ctx.db
      .insert(kbDocuments)
      .values({
        title: file.name,
        sourceType: 'upload',
        mimeType: file.type || 'text/plain',
      })
      .returning();

    // 2. Upload file to storage bucket for durable async job processing
    const storageKey = `uploads/${doc.id}-${file.name}`;
    await ctx.storage
      .bucket(KB_STORAGE_BUCKET)
      .upload(storageKey, new Uint8Array(await file.arrayBuffer()));

    // 3. Enqueue processing job (extraction + chunking + embedding happen async)
    await ctx.scheduler.add('knowledge-base:process-document', {
      documentId: doc.id,
      storageKey,
      mimeType: file.type || 'text/plain',
    });

    return c.json(doc, 201);
  })
  .get('/documents', async (c) => {
    const ctx = getCtx(c);
    // Exclude large jsonb columns (content, rawContent) from list query for performance
    const docs = await ctx.db
      .select({
        id: kbDocuments.id,
        title: kbDocuments.title,
        folder: kbDocuments.folder,
        sourceType: kbDocuments.sourceType,
        sourceId: kbDocuments.sourceId,
        sourceUrl: kbDocuments.sourceUrl,
        mimeType: kbDocuments.mimeType,
        status: kbDocuments.status,
        chunkCount: kbDocuments.chunkCount,
        metadata: kbDocuments.metadata,
        createdAt: kbDocuments.createdAt,
        updatedAt: kbDocuments.updatedAt,
      })
      .from(kbDocuments)
      .orderBy(desc(kbDocuments.createdAt));
    return c.json(docs);
  })
  .get('/documents/:id', async (c) => {
    const ctx = getCtx(c);
    const doc = (
      await ctx.db
        .select()
        .from(kbDocuments)
        .where(eq(kbDocuments.id, c.req.param('id')))
    )[0];
    if (!doc) throw notFound('Document not found');
    const chunks = await ctx.db
      .select()
      .from(kbChunks)
      .where(eq(kbChunks.documentId, doc.id))
      .orderBy(kbChunks.chunkIndex);

    // Return Plate Value content; fall back to reconstructing from chunk text
    let content = doc.content as PlateValue | null;
    if (!content && chunks.length > 0) {
      content = markdownToPlate(chunks.map((ch) => ch.content).join('\n\n'));
    }

    return c.json({ ...doc, content, chunks });
  })
  .patch('/documents/:id/content', async (c) => {
    const ctx = getCtx(c);
    const id = c.req.param('id');
    const body = await c.req.json();

    // 1. Validate input
    const parsed = plateValueSchema.safeParse(body.content);
    if (!parsed.success) {
      throw validation(parsed.error.flatten().fieldErrors);
    }
    const newValue = parsed.data as PlateValue;

    // 2. Load existing document — must exist and be ready
    const [doc] = await ctx.db
      .select()
      .from(kbDocuments)
      .where(eq(kbDocuments.id, id));
    if (!doc) throw notFound('Document not found');
    if (doc.status !== 'ready')
      throw conflict('Document is not ready for editing');

    // 3. Determine old value
    const existingContent = doc.content;
    let oldValue: PlateValue;
    if (existingContent && Array.isArray(existingContent)) {
      oldValue = existingContent as PlateValue;
    } else {
      const oldChunks = await ctx.db
        .select({ content: kbChunks.content })
        .from(kbChunks)
        .where(eq(kbChunks.documentId, id))
        .orderBy(kbChunks.chunkIndex);
      const concatenated = oldChunks.map((ch) => ch.content).join('\n\n');
      oldValue = concatenated
        ? markdownToPlate(concatenated)
        : [{ type: 'p', children: [{ text: '' }] }];
    }

    // 4. Diff top-level blocks
    const diff = diffPlateValue(oldValue, newValue);
    const affectedRanges = [...diff.changed, ...diff.added, ...diff.removed];

    // 5. Re-chunk full document
    const allNewChunks = blockChunk(newValue).filter(
      (ch) => ch.content.trim().length > 0,
    );

    if (affectedRanges.length === 0) {
      // No semantic changes — just persist the new value
      await ctx.db
        .update(kbDocuments)
        .set({ content: newValue as unknown })
        .where(eq(kbDocuments.id, id));
      return c.json({ success: true, rechunkedCount: 0, reembeddedCount: 0 });
    }

    // 6. Identify chunks that need re-embedding vs. can reuse old embeddings
    const rechunkedChunks = allNewChunks.filter((ch) =>
      isBlockRangeAffected(ch.blockRange, affectedRanges),
    );

    // Build a content→embedding map from existing chunks to reuse unchanged embeddings
    const oldChunkRecords = await ctx.db
      .select({ content: kbChunks.content, embedding: kbChunks.embedding })
      .from(kbChunks)
      .where(eq(kbChunks.documentId, id));
    const oldEmbeddingMap = new Map<string, number[] | null>(
      oldChunkRecords.map((ch) => [ch.content, ch.embedding]),
    );

    // 7. Embed only changed chunks (outside transaction — API call can't be rolled back)
    const newEmbeddings =
      rechunkedChunks.length > 0
        ? await embedChunks(rechunkedChunks.map((ch) => ch.content))
        : [];
    const rechunkedEmbeddingMap = new Map<number, number[]>(
      rechunkedChunks.map((ch, idx) => [ch.index, newEmbeddings[idx]]),
    );

    // 8. Fully transactional: delete all old chunks → batch insert new → update doc
    await ctx.db.transaction(async (tx) => {
      await tx.delete(kbChunks).where(eq(kbChunks.documentId, id));

      if (allNewChunks.length > 0) {
        await tx.insert(kbChunks).values(
          allNewChunks.map((chunk) => {
            const isChanged = isBlockRangeAffected(
              chunk.blockRange,
              affectedRanges,
            );
            const embedding = isChanged
              ? (rechunkedEmbeddingMap.get(chunk.index) ?? undefined)
              : (oldEmbeddingMap.get(chunk.content) ?? undefined);
            return {
              documentId: id,
              content: chunk.content,
              chunkIndex: chunk.index,
              tokenCount: chunk.tokenCount,
              embedding: embedding as number[] | undefined,
            };
          }),
        );
      }

      await tx
        .update(kbDocuments)
        .set({ content: newValue as unknown, chunkCount: allNewChunks.length })
        .where(eq(kbDocuments.id, id));
    });

    return c.json({
      success: true,
      rechunkedCount: rechunkedChunks.length,
      reembeddedCount: rechunkedChunks.length,
    });
  })
  .delete('/documents/:id', async (c) => {
    const ctx = getCtx(c);
    const id = c.req.param('id');
    // Chunks cascade-delete via FK onDelete: 'cascade'
    await ctx.db.delete(kbDocuments).where(eq(kbDocuments.id, id));
    return c.json({ success: true });
  })
  .patch('/documents/:id', async (c) => {
    const ctx = getCtx(c);
    const id = c.req.param('id');
    const metaSchema = z.object({
      title: z.string().min(1).optional(),
      folder: z.string().nullable().optional(),
    });
    const parsed = metaSchema.safeParse(await c.req.json());
    if (!parsed.success) throw validation(parsed.error.flatten().fieldErrors);
    const body = parsed.data;

    const [doc] = await ctx.db
      .update(kbDocuments)
      .set({
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.folder !== undefined ? { folder: body.folder } : {}),
      })
      .where(eq(kbDocuments.id, id))
      .returning();
    if (!doc) throw notFound('Document not found');
    return c.json(doc);
  })
  // Folders
  .get('/folders', async (c) => {
    const ctx = getCtx(c);
    const rows = await ctx.db
      .select({
        folder: kbDocuments.folder,
        count: sql<number>`count(*)::int`,
      })
      .from(kbDocuments)
      .groupBy(kbDocuments.folder)
      .orderBy(kbDocuments.folder);
    return c.json(rows);
  })
  .post('/folders/move', async (c) => {
    const ctx = getCtx(c);
    const moveSchema = z.object({
      documentIds: z.array(z.string().min(1)),
      folder: z.string().nullable(),
    });
    const parsed = moveSchema.safeParse(await c.req.json());
    if (!parsed.success) throw validation(parsed.error.flatten().fieldErrors);
    const body = parsed.data;

    await ctx.db
      .update(kbDocuments)
      .set({ folder: body.folder })
      .where(inArray(kbDocuments.id, body.documentIds));
    return c.json({ ok: true });
  })
  // Search
  .post('/search', async (c) => {
    const ctx = getCtx(c);
    const searchSchema = z.object({
      query: z.string().min(1),
      limit: z.number().int().positive().optional(),
      vectorWeight: z.number().min(0).max(1).optional(),
      keywordWeight: z.number().min(0).max(1).optional(),
      sourceIds: z.array(z.string()).optional(),
    });
    const parsed = searchSchema.safeParse(await c.req.json());
    if (!parsed.success) throw validation(parsed.error.flatten().fieldErrors);
    const body = parsed.data;

    const { cleanQuery, sortHint } = extractIntent(body.query);

    const results = await hybridSearch(ctx.db, cleanQuery, {
      limit: body.limit,
      vectorWeight: body.vectorWeight,
      keywordWeight: body.keywordWeight,
      sourceIds: body.sourceIds,
      sortHint,
    });
    return c.json({ query: body.query, results });
  })
  // Suggestions for autocomplete (document titles)
  .get('/suggestions', async (c) => {
    const ctx = getCtx(c);
    const docs = await ctx.db
      .select({ title: kbDocuments.title })
      .from(kbDocuments)
      .orderBy(desc(kbDocuments.createdAt))
      .limit(200);
    const suggestions = docs.map((d) => d.title).filter(Boolean);
    return c.json({ suggestions });
  })
  // Sources CRUD
  .post('/sources', async (c) => {
    const ctx = getCtx(c);
    const sourceSchema = z.object({
      name: z.string().min(1),
      type: z.enum(['crawl', 'google-drive', 'sharepoint']),
      config: z.record(z.string(), z.unknown()).optional(),
      syncSchedule: z.string().optional(),
    });
    const parsed = sourceSchema.safeParse(await c.req.json());
    if (!parsed.success) throw validation(parsed.error.flatten().fieldErrors);
    const body = parsed.data;

    const [source] = await ctx.db
      .insert(kbSources)
      .values({
        name: body.name,
        type: body.type,
        config: body.config ? JSON.stringify(body.config) : null,
        syncSchedule: body.syncSchedule,
      })
      .returning();
    return c.json(source, 201);
  })
  .get('/sources', async (c) => {
    const ctx = getCtx(c);
    const sources = await ctx.db
      .select()
      .from(kbSources)
      .orderBy(desc(kbSources.createdAt));
    return c.json(sources);
  })
  .put('/sources/:id', async (c) => {
    const ctx = getCtx(c);
    const sourceUpdateSchema = z.object({
      name: z.string().min(1).optional(),
      type: z.enum(['crawl', 'google-drive', 'sharepoint']).optional(),
      config: z.record(z.string(), z.unknown()).optional(),
      syncSchedule: z.string().nullable().optional(),
    });
    const parsed = sourceUpdateSchema.safeParse(await c.req.json());
    if (!parsed.success) throw validation(parsed.error.flatten().fieldErrors);
    const body = parsed.data;

    const [source] = await ctx.db
      .update(kbSources)
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
  })
  .delete('/sources/:id', async (c) => {
    const ctx = getCtx(c);
    const id = c.req.param('id');
    const docs = await ctx.db
      .select({ id: kbDocuments.id })
      .from(kbDocuments)
      .where(eq(kbDocuments.sourceId, id));
    for (const doc of docs) {
      await ctx.db.delete(kbChunks).where(eq(kbChunks.documentId, doc.id));
    }
    await ctx.db.delete(kbDocuments).where(eq(kbDocuments.sourceId, id));
    await ctx.db.delete(kbSources).where(eq(kbSources.id, id));
    return c.json({ success: true });
  })
  // Sync trigger + logs
  .post('/sources/:id/sync', async (c) => {
    const ctx = getCtx(c);
    const sourceId = c.req.param('id');
    const source = (
      await ctx.db.select().from(kbSources).where(eq(kbSources.id, sourceId))
    )[0];
    if (!source) throw notFound('Source not found');

    // Trigger sync in background (fire and forget)
    syncSource(ctx.db, ctx.integrations, source).catch((err) =>
      logger.error('[kb] sync_source_error', {
        sourceId: source.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return c.json({ message: 'Sync started' });
  })
  .get('/sources/:id/logs', async (c) => {
    const ctx = getCtx(c);
    const logs = await ctx.db
      .select()
      .from(kbSyncLogs)
      .where(eq(kbSyncLogs.sourceId, c.req.param('id')))
      .orderBy(desc(kbSyncLogs.startedAt));
    return c.json(logs);
  })
  // OAuth callbacks
  .get('/oauth/google/callback', async (c) => {
    const ctx = getCtx(c);
    const code = c.req.query('code');
    const sourceId = c.req.query('state');
    if (!code || !sourceId) return c.text('Missing code or state', 400);

    const source = (
      await ctx.db.select().from(kbSources).where(eq(kbSources.id, sourceId))
    )[0];
    const integrationId = await exchangeGoogleCode(
      ctx.integrations,
      sourceId,
      code,
      {
        createdBy: ctx.user?.id,
        label: source?.name ?? `KB source ${sourceId}`,
      },
    );

    const existingConfig = source?.config ? JSON.parse(source.config) : {};
    await ctx.db
      .update(kbSources)
      .set({ config: JSON.stringify({ ...existingConfig, integrationId }) })
      .where(eq(kbSources.id, sourceId));

    return c.redirect('/knowledge-base/sources');
  })
  .get('/oauth/microsoft/callback', async (c) => {
    const ctx = getCtx(c);
    const code = c.req.query('code');
    const sourceId = c.req.query('state');
    if (!code || !sourceId) return c.text('Missing code or state', 400);

    const source = (
      await ctx.db.select().from(kbSources).where(eq(kbSources.id, sourceId))
    )[0];
    const integrationId = await exchangeSharePointCode(
      ctx.integrations,
      sourceId,
      code,
      {
        createdBy: ctx.user?.id,
        label: source?.name ?? `KB source ${sourceId}`,
      },
    );

    const existingConfig = source?.config ? JSON.parse(source.config) : {};
    await ctx.db
      .update(kbSources)
      .set({ config: JSON.stringify({ ...existingConfig, integrationId }) })
      .where(eq(kbSources.id, sourceId));

    return c.redirect('/knowledge-base/sources');
  })
  // OAuth auth URL generators
  .get('/sources/:id/auth-url', async (c) => {
    const ctx = getCtx(c);
    const sourceId = c.req.param('id');
    const source = (
      await ctx.db.select().from(kbSources).where(eq(kbSources.id, sourceId))
    )[0];
    if (!source) throw notFound('Source not found');

    if (source.type === 'google-drive') {
      const url = await getGoogleAuthUrl(sourceId);
      return c.json({ url });
    }
    if (source.type === 'sharepoint') {
      const url = getSharePointAuthUrl(sourceId);
      return c.json({ url });
    }
    return c.json({ error: 'Source type does not require OAuth' }, 400);
  })
  // Reindex: backfill Plate Value content for existing documents, then re-chunk/re-embed all
  .post('/reindex', async (c) => {
    const ctx = getCtx(c);
    // Fire-and-forget: migration can be slow for large document sets
    migrateExistingDocuments(ctx.db, { reembed: true }).catch((err) =>
      logger.error('[kb] reindex_error', {
        error: err instanceof Error ? err.message : String(err),
      }),
    );

    return c.json({ message: 'Reindex triggered' });
  });

export type KnowledgeBaseRoutes = typeof knowledgeBaseRoutes;
