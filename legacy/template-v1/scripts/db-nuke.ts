/**
 * Nuke script — drops the database entirely.
 *
 * Usage: bun run db:nuke
 */
import postgres from 'postgres'

const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error(`${red('✗')} DATABASE_URL is required`)
  process.exit(1)
}

const url = new URL(databaseUrl)
const dbName = url.pathname.slice(1)
if (!/^[a-zA-Z0-9_-]+$/.test(dbName)) {
  console.error(`${red('✗')} Invalid database name: ${dbName}`)
  process.exit(1)
}
url.pathname = '/postgres'

const adminSql = postgres(url.toString())
try {
  await adminSql.unsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid <> pg_backend_pid()`,
  )
  await adminSql.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`)
} finally {
  await adminSql.end()
}

console.log(`${green('✓')} Database "${dbName}" dropped`)
