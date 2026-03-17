import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL || './data/pgdata';
const isPostgres =
  url.startsWith('postgres://') || url.startsWith('postgresql://');

export default defineConfig({
  schema: [
    '../core/src/modules/*/schema.ts',
    '../core/src/infra/webhooks-schema.ts',
    './modules/*/schema.ts',
  ],
  out: './drizzle',
  dialect: 'postgresql',
  ...(isPostgres
    ? { dbCredentials: { url } }
    : {
        driver: 'pglite' as const,
        dbCredentials: {
          url,
          extensions: {
            vector: (await import('@electric-sql/pglite/vector')).vector,
            pgcrypto: (await import('@electric-sql/pglite/contrib/pgcrypto'))
              .pgcrypto,
          },
        } as any,
      }),
});
