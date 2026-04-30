import { dirname, join } from 'node:path'
import { defineConfig } from 'drizzle-kit'

const url = process.env.DATABASE_URL ?? 'postgres://vobase:vobase@localhost:5432/vobase'

// Resolve core schema paths dynamically so tsc + drizzle-kit both find them
const coreSrc = dirname(require.resolve('@vobase/core'))

export default defineConfig({
  schema: [
    join(coreSrc, 'db/pg-schemas.ts'),
    join(coreSrc, 'schemas/*.ts'),
    './runtime/index.ts',
    './modules/*/schema.ts',
  ],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
})
