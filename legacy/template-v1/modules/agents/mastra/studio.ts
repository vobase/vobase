/**
 * Dev-only Studio SPA middleware.
 * Serves the Mastra Studio UI from node_modules/mastra/dist/studio/,
 * replacing placeholder tokens in index.html with runtime config.
 *
 * Gated by NODE_ENV !== 'production' — never serves in prod builds.
 */
import { extname, join } from 'node:path'
import { Hono } from 'hono'

const STUDIO_DIST = join(import.meta.dir, '../node_modules/mastra/dist/studio')

const TOKEN_VALUES: Record<string, string> = {
  '%%MASTRA_STUDIO_BASE_PATH%%': '/studio',
  '%%MASTRA_TELEMETRY_DISABLED%%': 'true',
  '%%MASTRA_SERVER_HOST%%': '',
  '%%MASTRA_SERVER_PORT%%': String(process.env.PORT || 3000),
  '%%MASTRA_API_PREFIX%%': '/api/mastra',
  '%%MASTRA_HIDE_CLOUD_CTA%%': 'true',
  '%%MASTRA_SERVER_PROTOCOL%%': 'http',
  '%%MASTRA_CLOUD_API_ENDPOINT%%': '',
  '%%MASTRA_EXPERIMENTAL_FEATURES%%': '',
  '%%MASTRA_TEMPLATES%%': '',
  '%%MASTRA_AUTO_DETECT_URL%%': 'true',
  '%%MASTRA_REQUEST_CONTEXT_PRESETS%%': '',
  '%%MASTRA_THEME_TOGGLE%%': 'true',
}

/** Replace all 13 placeholder tokens in Studio index.html. */
function replaceTokens(html: string): string {
  let result = html
  for (const [token, value] of Object.entries(TOKEN_VALUES)) {
    result = result.replaceAll(token, value)
  }
  return result
}

/**
 * Create a Hono sub-app that serves Mastra Studio at /studio.
 * Reads index.html once at startup and caches the token-replaced result.
 */
export function createStudioMiddleware(): Hono {
  const studio = new Hono()

  // Cache the processed HTML at startup
  let cachedHtml: string | null = null

  async function getStudioHtml(): Promise<string | null> {
    if (cachedHtml) return cachedHtml
    const file = Bun.file(join(STUDIO_DIST, 'index.html'))
    if (!(await file.exists())) return null
    cachedHtml = replaceTokens(await file.text())
    return cachedHtml
  }

  // Serve static assets (JS/CSS bundles, fonts, icons)
  // Uses Bun.file() directly because serveStatic receives the full path
  // including /studio prefix, but files live at STUDIO_DIST/assets/.
  studio.get('/assets/*', async (c) => {
    const assetPath = c.req.path.replace(/^\/studio\/assets\//, '')
    const file = Bun.file(join(STUDIO_DIST, 'assets', assetPath))
    if (!(await file.exists())) return c.notFound()
    const ext = extname(assetPath)
    const contentType =
      ext === '.js'
        ? 'application/javascript'
        : ext === '.css'
          ? 'text/css'
          : ext === '.woff'
            ? 'font/woff'
            : ext === '.woff2'
              ? 'font/woff2'
              : ext === '.ttf'
                ? 'font/ttf'
                : 'application/octet-stream'
    return new Response(file, {
      headers: { 'content-type': contentType },
    })
  })

  // Serve mastra.svg icon
  studio.get('/mastra.svg', async (c) => {
    const file = Bun.file(join(STUDIO_DIST, 'mastra.svg'))
    if (!(await file.exists())) return c.notFound()
    return new Response(file, {
      headers: { 'content-type': 'image/svg+xml' },
    })
  })

  // SSE refresh endpoint — no-op stream (Studio handles reconnect gracefully)
  studio.get('/refresh-events', (c) => {
    return c.text('', 200)
  })

  // SPA fallback — serve index.html for all other routes
  studio.get('*', async (c) => {
    const html = await getStudioHtml()
    if (!html) {
      return c.text('Mastra Studio not found. Ensure mastra is installed.', 404)
    }
    return c.html(html)
  })

  return studio
}
