import fs from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/**
 * Skip HMR for backend-only module files (handlers, jobs, libs, seeds, tests).
 * These are in the same `modules/` tree as pages, but aren't valid browser code.
 * Without this, editing a handler triggers a full page reload or Vite crash.
 */
function ignoreBackendHmr(): Plugin {
  // Match backend-only files but not pages/ (which are frontend components)
  const backendPattern = /modules\/(?!.*\/pages\/).*\/(handlers|jobs|lib|seed|schema|index)\.(ts|tsx)$/
  return {
    name: 'ignore-backend-hmr',
    handleHotUpdate({ file }) {
      if (backendPattern.test(file)) return []
    },
  }
}

/**
 * Serve site.webmanifest with %VITE_*% env substitution (same syntax as index.html).
 * Source lives at the template root so it stays out of public/ (where Vite copies
 * files verbatim). Dev: middleware serves `/site.webmanifest`. Build: emits asset.
 */
function webmanifestEnv(): Plugin {
  const source = path.resolve(__dirname, 'lib/site.webmanifest.tpl')
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
    react(),
    tailwindcss(),
    ignoreBackendHmr(),
    webmanifestEnv(),
    tanstackRouter({
      target: 'react',
      virtualRouteConfig: './src/routes.ts',
      routesDirectory: './src',
      generatedRouteTree: './src/routeTree.gen.ts',
      routeFileIgnorePattern: '(layout|.test|.spec|_components)',
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@modules': path.resolve(__dirname, './modules'),
    },
  },
  server: {
    allowedHosts: true,
    watch: {
      ignored: [
        '**/.omc/**',
        '**/.claude/**',
        '**/.stitch/**',
        '**/data/**',
        '**/dogfood-output/**',
        '**/mastra/**',
        'server.ts',
        'vobase.config.ts',
      ],
    },
    proxy: {
      '/api': 'http://localhost:3000',
      '/mcp': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/studio': 'http://localhost:3000',
    },
  },
})
