import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { pgTable, uniqueIndex } from 'drizzle-orm/pg-core'
import { z } from 'zod'

import {
  __resetDeclarativeBindingsForTests,
  __resetDeclarativeRegistryForTests,
  bindDeclarativeTable,
  defineDeclarativeResource,
} from './'
import { ExportCliError, parseExportArgv, runExportCli } from './cli'
import { authoredColumns } from './columns'
import { serializeYaml } from './parse'
import type { Authored, Origin } from './types'

interface SampleBody {
  name: string
}

const sample = pgTable('sample_view', authoredColumns<SampleBody>(), (t) => [
  uniqueIndex('uq_sample').on(t.slug, t.scope),
])

beforeEach(() => {
  __resetDeclarativeRegistryForTests()
  __resetDeclarativeBindingsForTests()
  defineDeclarativeResource({
    kind: 'sample_view',
    sourceGlobs: 'modules/*/views/*.view.yaml',
    format: 'yaml',
    bodySchema: z.object({ name: z.string() }) as unknown as z.ZodType<SampleBody>,
    serialize: (b) => serializeYaml(b),
  })
  bindDeclarativeTable('sample_view', sample)
})

afterEach(() => {
  __resetDeclarativeRegistryForTests()
  __resetDeclarativeBindingsForTests()
})

function rowFixture(overrides: Partial<Authored<SampleBody>> = {}): Authored<SampleBody> {
  const now = new Date()
  return {
    id: 'r1',
    slug: 'default',
    scope: 'object:contacts',
    body: { name: 'All' },
    origin: 'agent' satisfies Origin,
    fileSourcePath: 'modules/contacts/views/default.view.yaml',
    fileContentHash: null,
    ownerStaffId: null,
    active: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function fakeDb(rows: Authored<SampleBody>[]) {
  return {
    select() {
      return {
        from() {
          return { where: () => Promise.resolve(rows) }
        },
      }
    },
  }
}

describe('parseExportArgv', () => {
  it('parses positional + flags', () => {
    const opts = parseExportArgv(['saved_views', 'default', '--scope', 'object:contacts', '--out', 'foo.yaml'])
    expect(opts).toEqual({
      kind: 'saved_views',
      slug: 'default',
      scope: 'object:contacts',
      out: 'foo.yaml',
    })
  })

  it('rejects missing positional', () => {
    expect(() => parseExportArgv(['saved_views'])).toThrow(ExportCliError)
  })

  it('rejects unknown flags', () => {
    expect(() => parseExportArgv(['k', 's', '--bogus'])).toThrow(/unknown flag/)
  })
})

describe('runExportCli', () => {
  it('writes serialized body to row.fileSourcePath when no --out', async () => {
    const writes: Array<[string, string]> = []
    const result = await runExportCli(
      {
        db: fakeDb([rowFixture()]),
        rootDir: '/repo',
        writeFile: async (p, c) => {
          writes.push([p, c])
        },
      },
      { kind: 'sample_view', slug: 'default', scope: 'object:contacts' },
    )
    expect(writes).toHaveLength(1)
    expect(writes[0]?.[0]).toBe('/repo/modules/contacts/views/default.view.yaml')
    expect(writes[0]?.[1]).toContain('name')
    expect(result.relPath).toBe('modules/contacts/views/default.view.yaml')
    expect(result.bytesWritten).toBeGreaterThan(0)
  })

  it('refuses file-origin rows', async () => {
    await expect(
      runExportCli(
        {
          db: fakeDb([rowFixture({ origin: 'file' as Origin })]),
          rootDir: '/repo',
          writeFile: async () => {},
        },
        { kind: 'sample_view', slug: 'default', scope: 'object:contacts' },
      ),
    ).rejects.toMatchObject({ code: 'origin_file' })
  })

  it('errors when row has no fileSourcePath and no --out', async () => {
    await expect(
      runExportCli(
        {
          db: fakeDb([rowFixture({ fileSourcePath: null })]),
          rootDir: '/repo',
          writeFile: async () => {},
        },
        { kind: 'sample_view', slug: 'default', scope: 'object:contacts' },
      ),
    ).rejects.toMatchObject({ code: 'no_target_path' })
  })

  it('honors --out override', async () => {
    const writes: Array<[string, string]> = []
    const res = await runExportCli(
      {
        db: fakeDb([rowFixture({ fileSourcePath: null })]),
        rootDir: '/repo',
        writeFile: async (p, c) => {
          writes.push([p, c])
        },
      },
      { kind: 'sample_view', slug: 'default', scope: 'object:contacts', out: 'tmp/promoted.view.yaml' },
    )
    expect(writes[0]?.[0]).toBe('/repo/tmp/promoted.view.yaml')
    expect(res.relPath).toBe('tmp/promoted.view.yaml')
  })

  it('errors when row not found', async () => {
    await expect(
      runExportCli(
        { db: fakeDb([]), rootDir: '/repo', writeFile: async () => {} },
        { kind: 'sample_view', slug: 'missing' },
      ),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('errors on unknown kind', async () => {
    await expect(
      runExportCli(
        { db: fakeDb([]), rootDir: '/repo', writeFile: async () => {} },
        { kind: 'never_registered', slug: 'x' },
      ),
    ).rejects.toMatchObject({ code: 'unknown_kind' })
  })
})
