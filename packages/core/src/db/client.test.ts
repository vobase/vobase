import { describe, expect, it } from 'bun:test'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'

import { getSharedPGlite } from '../test-helpers'
import { createDatabase } from './client'

describe('createDatabase', () => {
  it('creates a PGlite-backed drizzle instance for in-memory path', () => {
    const db = createDatabase('memory://')

    expect(db).toBeDefined()
    expect(typeof db.select).toBe('function')
    expect(typeof db.insert).toBe('function')
  })

  it('returns the same cached instance for repeated calls', () => {
    const db1 = createDatabase('memory://')
    const db2 = createDatabase('memory://')
    expect(db1).toBe(db2)
  })

  it('PGlite supports basic SQL queries', async () => {
    const pglite = await getSharedPGlite()
    const db = drizzle({ client: pglite })

    const result = await db.execute(sql`SELECT 1 + 1 AS two`)
    expect((result as unknown as { rows: Array<{ two: number }> }).rows[0].two).toBe(2)
  })
})
