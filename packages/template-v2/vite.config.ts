import fs from 'node:fs'
import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/**
 * Serve site.webmanifest with %VITE_*% env substitution (same syntax as index.html).
 * Source lives at the template root so it stays out of public/ (where Vite copies
 * files verbatim). Dev: middleware serves `/site.webmanifest`. Build: emits asset.
 */
function webmanifestEnv(): Plugin {
  const source = path.resolve(import.meta.dirname, 'lib/site.webmanifest.tpl')
  let env: Record<string, string> = {}
  const render = () => fs.readFileSync(source, 'utf8').replace(/%(VITE_[A-Z0-9_]+)%/g, (_, key) => env[key] ?? '')
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
    tsconfigPaths: true
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
