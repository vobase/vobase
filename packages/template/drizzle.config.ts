import { dirname, join } from 'node:path';
import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL || './data/pgdata';
const isPostgres =
  url.startsWith('postgres://') || url.startsWith('postgresql://');

// Resolve core schema paths dynamically — works in both monorepo and standalone
const coreSrc = dirname(require.resolve('@vobase/core'));

export default defineConfig({
  schema: [
    join(coreSrc, 'modules/*/schema.ts'),
    join(coreSrc, 'infra/webhooks-schema.ts'),
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
