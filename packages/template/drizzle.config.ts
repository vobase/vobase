import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: [
    '../core/src/modules/*/schema.ts',
    '../core/src/infra/webhooks-schema.ts',
    './modules/*/schema.ts',
  ],
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: { url: './data/vobase.db' },
});
