/**
 * Unit tests for `loadContactsIndexContributors` — the `/INDEX.md` recent
 * contact-activity block. The contributor filters by `updatedAt` against a
 * configurable recency window and sorts most-recent first; tested with a
 * stub `ContactsService.list` slice.
 */

import { describe, expect, it } from 'bun:test'
import type { Contact } from '@modules/contacts/schema'
import { IndexFileBuilder } from '@vobase/core'

import { type ContactsIndexReader, loadContactsIndexContributors } from './agent'

const ORG_ID = 'org0test0'

function fakeContact(overrides: Partial<Contact>): Contact {
  return {
    id: overrides.id ?? 'cont1',
    organizationId: ORG_ID,
    displayName: overrides.displayName ?? null,
    phone: overrides.phone ?? null,
    email: overrides.email ?? null,
    notes: '',
    segments: [],
    attributes: {},
    snapshotKey: null,
    createdAt: new Date('2026-04-01T00:00:00Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-04-26T00:00:00Z'),
    ...overrides,
  } as Contact
}

function makeReader(rows: Contact[]): ContactsIndexReader {
  return {
    list(_orgId) {
      return Promise.resolve(rows)
    },
  }
}

describe('loadContactsIndexContributors', () => {
  const NOW = new Date('2026-04-26T12:00:00Z').getTime()
  const dateAgo = (ms: number) => new Date(NOW - ms)

  it('renders null when no contact has updated within the window', async () => {
    // All updates are 48h ago, window is the default 24h.
    const rows = [
      fakeContact({ id: 'a', updatedAt: dateAgo(48 * 60 * 60 * 1000) }),
      fakeContact({ id: 'b', updatedAt: dateAgo(72 * 60 * 60 * 1000) }),
    ]
    // Pin Date.now() so the window is deterministic.
    const realNow = Date.now
    Date.now = () => NOW
    try {
      const contribs = await loadContactsIndexContributors({ organizationId: ORG_ID, contacts: makeReader(rows) })
      expect(contribs[0].render({ file: 'INDEX.md' })).toBeNull()
    } finally {
      Date.now = realNow
    }
  })

  it('lists only contacts updated within the window, most-recent first', async () => {
    const rows = [
      fakeContact({ id: 'old', displayName: 'Old', updatedAt: dateAgo(30 * 60 * 60 * 1000) }), // 30h
      fakeContact({ id: 'mid', displayName: 'Mid', updatedAt: dateAgo(2 * 60 * 60 * 1000) }), // 2h
      fakeContact({ id: 'new', displayName: 'New', updatedAt: dateAgo(15 * 60 * 1000) }), // 15min
    ]
    const realNow = Date.now
    Date.now = () => NOW
    try {
      const contribs = await loadContactsIndexContributors({
        organizationId: ORG_ID,
        contacts: makeReader(rows),
        recentMs: 24 * 60 * 60 * 1000,
      })
      const out = contribs[0].render({ file: 'INDEX.md' }) ?? ''
      expect(out).toContain('# Recent Contact Activity (last 24h, 2)')
      const idxNew = out.indexOf('/contacts/new/')
      const idxMid = out.indexOf('/contacts/mid/')
      const idxOld = out.indexOf('/contacts/old/')
      expect(idxNew).toBeGreaterThan(0)
      expect(idxMid).toBeGreaterThan(idxNew) // most-recent first
      expect(idxOld).toBe(-1) // outside window
    } finally {
      Date.now = realNow
    }
  })

  it('respects a custom recentMs window', async () => {
    const rows = [
      fakeContact({ id: 'a', updatedAt: dateAgo(60 * 1000) }), // 1min
      fakeContact({ id: 'b', updatedAt: dateAgo(10 * 60 * 1000) }), // 10min — outside 5min window
    ]
    const realNow = Date.now
    Date.now = () => NOW
    try {
      const contribs = await loadContactsIndexContributors({
        organizationId: ORG_ID,
        contacts: makeReader(rows),
        recentMs: 5 * 60 * 1000,
      })
      const out = contribs[0].render({ file: 'INDEX.md' }) ?? ''
      expect(out).toContain('1)')
      expect(out).toContain('/contacts/a/')
      expect(out).not.toContain('/contacts/b/')
    } finally {
      Date.now = realNow
    }
  })

  it('swallows reader errors and yields a null section', async () => {
    const reader: ContactsIndexReader = {
      list() {
        return Promise.reject(new Error('boom'))
      },
    }
    const contribs = await loadContactsIndexContributors({ organizationId: ORG_ID, contacts: reader })
    expect(contribs[0].render({ file: 'INDEX.md' })).toBeNull()
  })

  it('priorities order messaging (100) → schedules (200) → contacts (300) when joined', async () => {
    const realNow = Date.now
    Date.now = () => NOW
    try {
      const contribs = await loadContactsIndexContributors({
        organizationId: ORG_ID,
        contacts: makeReader([fakeContact({ id: 'x', updatedAt: dateAgo(60 * 1000) })]),
      })
      expect(contribs[0].priority).toBe(300)
    } finally {
      Date.now = realNow
    }
    const builder = new IndexFileBuilder().register({
      file: 'INDEX.md',
      priority: 100,
      render: () => '## first',
    })
    const realNow2 = Date.now
    Date.now = () => NOW
    try {
      const cContribs = await loadContactsIndexContributors({
        organizationId: ORG_ID,
        contacts: makeReader([fakeContact({ id: 'x', displayName: 'X', updatedAt: dateAgo(60 * 1000) })]),
      })
      builder.registerAll(cContribs)
    } finally {
      Date.now = realNow2
    }
    const out = builder.build({ file: 'INDEX.md' })
    expect(out.indexOf('## first')).toBeLessThan(out.indexOf('# Recent Contact Activity'))
  })
})
