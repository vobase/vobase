#!/usr/bin/env bun
/**
 * Drops + recreates the dev database. Used by `bun run db:reset`.
 */
import postgres from 'postgres'

const url = process.env.DATABASE_URL ?? 'postgres://vobase:vobase@localhost:5432/vobase'

const u = new URL(url)
const dbName = u.pathname.replace(/^\//, '')
if (!dbName) {
  throw new Error(`db-nuke: no database name in ${url}`)
}

u.pathname = '/postgres'
const admin = postgres(u.toString(), { max: 1 })

try {
  process.stdout.write(`→ dropping ${dbName}\n`)
  await admin.unsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}'`)
  await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`)
  await admin.unsafe(`CREATE DATABASE "${dbName}"`)
  process.stdout.write(`→ recreated ${dbName}\n`)
} finally {
  await admin.end()
}
