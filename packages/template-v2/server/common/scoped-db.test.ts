/**
 * scoped-db.test.ts — `ScopedDb` refines Drizzle's `PostgresJsDatabase<Schema>`
 * without broadening the public surface.
 */

import { describe, expect, it } from 'bun:test'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { drizzle } from 'drizzle-orm/postgres-js'

import type { OrganizationScope, Schema, ScopedDb } from './scoped-db'

type AssertEqual<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false
type AssertTrue<T extends true> = T
type AssertExtends<T, U> = [T] extends [U] ? true : false

describe('ScopedDb contract', () => {
  it('ScopedDb is assignable to PostgresJsDatabase<Schema> (refines)', () => {
    type _Sub = AssertTrue<AssertExtends<ScopedDb, PostgresJsDatabase<Schema>>>
    const _sub: _Sub = true
    expect(_sub).toBe(true)
  })

  it('ScopedDb does not broaden the public surface beyond drizzle', () => {
    // Public keys are identical — no extra methods, no runtime brand.
    type _Keys = AssertTrue<AssertEqual<keyof ScopedDb, keyof PostgresJsDatabase<Schema>>>
    const _keys: _Keys = true
    expect(_keys).toBe(true)
  })

  it('Schema matches drizzle postgres-js driver inference for schema-less init', () => {
    type _SchemaShape = AssertTrue<AssertEqual<Schema, Record<string, unknown>>>
    const _shape: _SchemaShape = true
    expect(_shape).toBe(true)
  })

  it('a runtime drizzle handle is structurally assignable to ScopedDb', () => {
    const db = drizzle.mock()
    const scoped: ScopedDb = db
    expect(typeof scoped.insert).toBe('function')
    expect(typeof scoped.select).toBe('function')
    expect(typeof scoped.transaction).toBe('function')
  })

  it('OrganizationScope names the organization-filter carrier shape', () => {
    const scope: OrganizationScope = { organizationId: 't1' }
    expect(scope.organizationId).toBe('t1')
    type _TenantScope = AssertTrue<AssertEqual<keyof OrganizationScope, 'organizationId'>>
    const _ts: _TenantScope = true
    expect(_ts).toBe(true)
  })
})
