import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './modules/*/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  dbCredentials: { url: './data/vobase.db' },
});
