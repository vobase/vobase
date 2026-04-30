import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/**
 * Serve site.webmanifest with %VITE_*% env substitution (same syntax as index.html).
 * Inlined here (not under public/) because public/ is copied verbatim — we need
 * the env-substitution pass. Dev: middleware serves `/site.webmanifest`.
 * Build: emits asset.
 */
const WEBMANIFEST_TEMPLATE = JSON.stringify(
  {
    name: '%VITE_PRODUCT_NAME% - %VITE_VENDOR_NAME%',
    short_name: '%VITE_PRODUCT_NAME%',
    icons: [
      { src: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
    theme_color: '#0A0A0A',
    background_color: '#0A0A0A',
    display: 'standalone',
  },
  null,
  2,
)

function webmanifestEnv(): Plugin {
  let env: Record<string, string> = {}
  const render = () => WEBMANIFEST_TEMPLATE.replace(/%(VITE_[A-Z0-9_]+)%/g, (_, key) => env[key] ?? '')
  return {
    name: 'webmanifest-env',
    configResolved(config) {
      env = loadEnv(config.mode, config.envDir ?? config.root, 'VITE_')
    },
    configureServer(server) {
      server.middlewares.use('/site.webmanifest', (_req, res) => {
        res.setHeader('Content-Type', 'application/manifest+json')
        res.end(render())
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'site.webmanifest',
        source: render(),
      })
    },
  }
}

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      virtualRouteConfig: './src/routes.ts',
      routesDirectory: './src',
      generatedRouteTree: './src/routeTree.gen.ts',
      routeFileIgnorePattern:
        '^(api|lib|schemas|components|__tests__|__snapshots__)$|^(layout|api|lib|schemas)\\.tsx?$|\\.(test|spec)\\.',
    }),
    react(),
    tailwindcss(),
    webmanifestEnv(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist/web',
  },
})
