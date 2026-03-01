import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/modules/*/schema.ts',
  out: './migrations',
});
