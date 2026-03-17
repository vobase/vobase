import { join } from 'node:path';
import { createApp } from '@vobase/core';
import { serveStatic } from 'hono/bun';

import { setupSqliteVec } from './lib/sqlite-vec';
import { modules } from './modules';
import config from './vobase.config';

// Must run before createApp() which creates the Database instance
setupSqliteVec();

const app = await createApp({ ...config, modules });

const distPath = join(import.meta.dir, 'dist');
const indexFile = Bun.file(join(distPath, 'index.html'));
const hasIndex = await indexFile.exists();
const indexHtml = hasIndex ? await indexFile.text() : null;

// Serve static assets from Vite build
app.use('/assets/*', serveStatic({ root: distPath, rewriteRequestPath: (path) => path }));

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
};

// Re-export the generated AppType which preserves Hono's literal route types
// for use with hc<AppType>() in the frontend
export type { AppType } from './src/api-types.generated';
