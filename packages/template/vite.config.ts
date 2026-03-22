import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { routes } from './src/routes';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    tanstackRouter({
      virtualRouteConfig: routes,
      routesDirectory: './src',
      generatedRouteTree: './src/routeTree.gen.ts',
      routeFileIgnorePattern: '(layout|.test|.spec)',
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@modules': path.resolve(__dirname, './modules'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/mcp': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/studio': 'http://localhost:3000',
    },
  },
});
