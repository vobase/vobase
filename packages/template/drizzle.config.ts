import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: ['./db-schemas.ts', './modules/*/schema.ts'],
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: { url: './data/vobase.db' },
});
