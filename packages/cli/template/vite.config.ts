import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-vite-plugin';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    TanStackRouterVite({
      virtualRouteConfig: './src/routes.ts',
    }),
  ],
  resolve: {
    alias: {
      '@': './src',
      '@modules': './modules',
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/mcp': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
});
