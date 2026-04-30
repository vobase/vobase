import { dirname, join } from 'node:path'
import { defineConfig } from 'drizzle-kit'

const url = process.env.DATABASE_URL ?? 'postgres://localhost:5432/vobase'

// Resolve core schema paths dynamically — works in both monorepo and standalone
const coreSrc = dirname(require.resolve('@vobase/core'))

export default defineConfig({
  schema: [
    join(coreSrc, 'db/pg-schemas.ts'),
    join(coreSrc, 'modules/*/schema.ts'),
    join(coreSrc, 'infra/webhooks-schema.ts'),
    './modules/*/schema.ts',
  ],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
})
