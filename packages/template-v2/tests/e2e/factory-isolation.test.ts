/**
 * Factory isolation — proves per-organization `createFilesService` instances are
 * isolated in the same process. Two instances with different organizationIds
 * interleave calls against the same DB; each sees only its own org's rows.
 *
 * This test is the behavioral insurance that converting drive/files.ts from
 * top-level singletons to a factory actually fixes the `_tenantId = ''`
 * fallback bug — not by renaming the variable, but by making organizationId a
 * per-instance bound value that flows through every query.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { driveFiles } from '@modules/drive/schema'
import { createFilesService } from '@modules/drive/service/files'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../tests/helpers/test-db'

const ORG_A = 'org0alpha0'
const ORG_B = 'org0bravo00'

let db: TestDbHandle

beforeAll(async () => {
  await resetAndSeedDb()
  db = connectTestDb()

  // Seed two org-scoped /BUSINESS.md rows — one per org.
  await db.db
    .insert(driveFiles)
    .values([
      {
        id: 'drfalpha00',
        organizationId: ORG_A,
        scope: 'organization',
        scopeId: ORG_A,
        kind: 'file',
        name: 'BUSINESS.md',
        path: '/BUSINESS.md',
        mimeType: 'text/markdown',
        extractedText: 'ALPHA business profile.',
        source: 'admin_uploaded',
        processingStatus: 'ready',
      },
      {
        id: 'drfbravo00',
        organizationId: ORG_B,
        scope: 'organization',
        scopeId: ORG_B,
        kind: 'file',
        name: 'BUSINESS.md',
        path: '/BUSINESS.md',
        mimeType: 'text/markdown',
        extractedText: 'BRAVO business profile.',
        source: 'admin_uploaded',
        processingStatus: 'ready',
      },
    ])
    .onConflictDoNothing()
}, 60_000)

afterAll(async () => {
  if (db) await db.teardown()
})

describe('createFilesService factory isolation', () => {
  it('two instances with different organizationIds each read only their own org rows', async () => {
    const svcA = createFilesService({ db: db.db, organizationId: ORG_A })
    const svcB = createFilesService({ db: db.db, organizationId: ORG_B })

    // Interleave: A → B → A → B
    const aBiz1 = await svcA.getByPath({ scope: 'organization' }, '/BUSINESS.md')
    const bBiz1 = await svcB.getByPath({ scope: 'organization' }, '/BUSINESS.md')
    const aBiz2 = await svcA.getByPath({ scope: 'organization' }, '/BUSINESS.md')
    const bBiz2 = await svcB.getByPath({ scope: 'organization' }, '/BUSINESS.md')

    expect(aBiz1?.id).toBe('drfalpha00')
    expect(aBiz1?.organizationId).toBe(ORG_A)
    expect(aBiz2?.id).toBe('drfalpha00')

    expect(bBiz1?.id).toBe('drfbravo00')
    expect(bBiz1?.organizationId).toBe(ORG_B)
    expect(bBiz2?.id).toBe('drfbravo00')
  })

  it('getBusinessMd returns each org-bound content independently', async () => {
    const svcA = createFilesService({ db: db.db, organizationId: ORG_A })
    const svcB = createFilesService({ db: db.db, organizationId: ORG_B })

    const [a, b] = await Promise.all([svcA.getBusinessMd(), svcB.getBusinessMd()])

    expect(a).toBe('ALPHA business profile.')
    expect(b).toBe('BRAVO business profile.')
  })

  it('listFolder scope=organization returns rows only for the bound org', async () => {
    const svcA = createFilesService({ db: db.db, organizationId: ORG_A })
    const svcB = createFilesService({ db: db.db, organizationId: ORG_B })

    const [listA, listB] = await Promise.all([
      svcA.listFolder({ scope: 'organization' }, null),
      svcB.listFolder({ scope: 'organization' }, null),
    ])

    for (const row of listA) expect(row.organizationId).toBe(ORG_A)
    for (const row of listB) expect(row.organizationId).toBe(ORG_B)
    expect(listA.some((r) => r.id === 'drfalpha00')).toBe(true)
    expect(listB.some((r) => r.id === 'drfbravo00')).toBe(true)
    expect(listA.some((r) => r.organizationId === ORG_B)).toBe(false)
    expect(listB.some((r) => r.organizationId === ORG_A)).toBe(false)
  })

  it('an instance bound to empty organizationId finds no organization rows', async () => {
    const svcEmpty = createFilesService({ db: db.db, organizationId: '' })
    const row = await svcEmpty.getByPath({ scope: 'organization' }, '/BUSINESS.md')
    expect(row).toBeNull()
  })
})
