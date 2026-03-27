import { join } from 'node:path';
import { MastraServer } from '@mastra/hono';
import { createApp } from '@vobase/core';
import { serveStatic } from 'hono/bun';

import { getMastra, initMastra } from './mastra';
import { modules } from './modules';
import config from './vobase.config';

const app = await createApp({ ...config, modules });

// Initialize Mastra after createApp (init hook sets deps synchronously, but Mastra init is async)
try {
  // db.$client gives us the PGlite instance from the Drizzle connection
  const { getModuleDb } = await import('./mastra/lib/deps');
  const db = getModuleDb();
  await initMastra(db as unknown as { $client: unknown });

  const mastra = getMastra();
  const mastraServer = new MastraServer({
    // MastraServer expects its own Hono type; our app is compatible at runtime
    app: app as unknown as ConstructorParameters<typeof MastraServer>[0]['app'],
    mastra,
    prefix: '/api/mastra',
  });
  await mastraServer.init();
} catch (err) {
  console.warn('[server] Mastra routes not mounted:', (err as Error).message);
}

// Mount Mastra Studio SPA (dev-only)
if (process.env.NODE_ENV !== 'production') {
  const { createStudioMiddleware } = await import('./mastra/studio');
  app.route('/studio', createStudioMiddleware());
}

const distPath = join(import.meta.dir, 'dist');
const indexFile = Bun.file(join(distPath, 'index.html'));
const hasIndex = await indexFile.exists();
const indexHtml = hasIndex ? await indexFile.text() : null;

// Serve static assets from Vite build
app.use(
  '/assets/*',
  serveStatic({ root: distPath, rewriteRequestPath: (path) => path }),
);

// SPA fallback — return index.html for any non-API route
app.get('*', (c) => {
  if (indexHtml) {
    return c.html(indexHtml);
  }
  return c.text('Frontend not built. Run: bun run build', 404);
});

const port = Number(process.env.PORT) || 3000;

export default {
  port,
  fetch: app.fetch,
  idleTimeout: 255, // seconds (max) — prevent Bun from killing long-running AI streams
};

// Re-export the generated AppType which preserves Hono's literal route types
// for use with hc<AppType>() in the frontend
export type { AppType } from './src/api-types.generated';

// ─── Graceful shutdown ──────────────────────────────────────────────
// PGlite uses WAL and corrupts if killed without flushing.
// Handle SIGTERM (docker stop, pkill) and SIGINT (Ctrl-C) to close cleanly.
async function shutdown(signal: string) {
  console.log(`[server] ${signal} received, shutting down...`);
  try {
    const { getModuleDb } = await import('./mastra/lib/deps');
    const db = getModuleDb();
    const client = (
      db as unknown as { $client: { close?: () => Promise<void> } }
    ).$client;
    if (client?.close) {
      await client.close();
      console.log('[server] PGlite closed cleanly');
    }
  } catch {
    // deps may not be initialized yet
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
