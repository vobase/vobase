import { describe, expect, it } from 'bun:test'
import type { Contact } from '@modules/contacts/schema'
import type { StaffProfile } from '@modules/team/schema'

import { renderContactFrontmatter, renderStaffFrontmatter } from './profile-frontmatter'

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'c_marcus123',
    organizationId: 'org_1',
    displayName: 'Marcus Tan',
    phone: '+6591234567',
    email: 'marcus@northwind.sg',
    profile: '',
    memory: '',
    attributes: {
      industry: 'logistics',
      employeeCount: 120,
      renewalDate: '2026-09-01',
    },
    segments: ['enterprise', 'renewal-q3'],
    marketingOptOut: false,
    marketingOptOutAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

function makeStaffProfile(overrides: Partial<StaffProfile> = {}): StaffProfile {
  return {
    userId: 's_alice',
    organizationId: 'org_1',
    displayName: 'Alice',
    title: 'Senior CSM',
    sectors: ['logistics'],
    expertise: ['onboarding', 'renewals'],
    languages: ['en', 'zh'],
    capacity: 10,
    availability: 'active',
    attributes: {
      pager: 'pd-alice',
    },
    profile: '',
    memory: '',
    lastSeenAt: null,
    phoneNumber: null,
    phoneNumberVerified: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

describe('renderContactFrontmatter', () => {
  it('emits delimiters and sorted top-level keys', () => {
    const out = renderContactFrontmatter(makeContact())
    expect(out.startsWith('---\n')).toBe(true)
    const closingIdx = out.indexOf('\n---', 4)
    expect(closingIdx).toBeGreaterThan(0)
    const yaml = out.slice(4, closingIdx)
    const lines = yaml.split('\n').filter((l) => /^[A-Za-z]/.test(l))
    const topKeys = lines.map((l) => l.split(':')[0])
    expect(topKeys).toEqual([...topKeys].sort())
  })

  it('omits null / empty fields and emits attributes as nested map', () => {
    const out = renderContactFrontmatter(makeContact({ phone: null, email: null, segments: [] }))
    expect(out).not.toContain('phone:')
    expect(out).not.toContain('email:')
    expect(out).not.toContain('segments:')
    expect(out).toContain('displayName: "Marcus Tan"')
    expect(out).toContain('attributes:')
    expect(out).toContain('  industry: "logistics"')
    expect(out).toContain('  employeeCount: 120')
  })

  it('renders boolean false explicitly so a cleared opt-out is observable', () => {
    const out = renderContactFrontmatter(makeContact({ marketingOptOut: false }))
    expect(out).toContain('marketingOptOut: false')
  })

  it('produces byte-identical output on render-twice', () => {
    const c = makeContact()
    expect(renderContactFrontmatter(c)).toBe(renderContactFrontmatter(c))
  })

  it('sorts attributes alphabetically by key', () => {
    const out = renderContactFrontmatter(
      makeContact({
        attributes: { zeta: 'z', alpha: 'a', mid: 'm' },
      }),
    )
    const idxAlpha = out.indexOf('alpha:')
    const idxMid = out.indexOf('mid:')
    const idxZeta = out.indexOf('zeta:')
    expect(idxAlpha).toBeGreaterThan(0)
    expect(idxMid).toBeGreaterThan(idxAlpha)
    expect(idxZeta).toBeGreaterThan(idxMid)
  })

  it('quotes strings with embedded special characters safely', () => {
    const out = renderContactFrontmatter(
      makeContact({ displayName: 'Quote " test', attributes: { note: 'back\\slash' } }),
    )
    expect(out).toContain('displayName: "Quote \\" test"')
    expect(out).toContain('  note: "back\\\\slash"')
  })

  it('omits attributes block entirely when attributes map is empty', () => {
    const out = renderContactFrontmatter(makeContact({ attributes: {} }))
    expect(out).not.toContain('attributes:')
  })
})

describe('renderStaffFrontmatter', () => {
  it('renders the v1 staff field set without email', () => {
    const out = renderStaffFrontmatter(makeStaffProfile())
    expect(out).toContain('displayName: "Alice"')
    expect(out).toContain('title: "Senior CSM"')
    expect(out).toContain('availability: "active"')
    expect(out).toContain('capacity: 10')
    expect(out).toContain('expertise: ["onboarding", "renewals"]')
    expect(out).toContain('sectors: ["logistics"]')
    expect(out).toContain('languages: ["en", "zh"]')
    expect(out).toContain('attributes:')
    expect(out).toContain('  pager: "pd-alice"')
    expect(out).not.toContain('email:')
  })

  it('produces byte-identical output on render-twice', () => {
    const p = makeStaffProfile()
    expect(renderStaffFrontmatter(p)).toBe(renderStaffFrontmatter(p))
  })

  it('omits empty arrays and empty attributes', () => {
    const out = renderStaffFrontmatter(makeStaffProfile({ sectors: [], expertise: [], languages: [], attributes: {} }))
    expect(out).not.toContain('sectors:')
    expect(out).not.toContain('expertise:')
    expect(out).not.toContain('languages:')
    expect(out).not.toContain('attributes:')
  })
})
