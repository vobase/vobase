import { describe, expect, it } from 'bun:test'
import type { Contact } from '@modules/contacts/schema'
import type { StaffProfile } from '@modules/team/schema'

import {
  diffProfile,
  type ParsedProfile,
  parseFrontmatter,
  renderContactFrontmatter,
  renderStaffFrontmatter,
} from './profile-frontmatter'

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

describe('parseFrontmatter', () => {
  it('returns null for missing leading delimiter', () => {
    expect(parseFrontmatter('# Heading only\n')).toBeNull()
  })

  it('returns null for missing closing delimiter', () => {
    expect(parseFrontmatter('---\nfoo: bar\n')).toBeNull()
  })

  it('returns null for malformed YAML', () => {
    expect(parseFrontmatter('---\n: : :\n---\n')).toBeNull()
  })

  it('keeps date-shaped strings as strings (no Date coercion)', () => {
    const parsed = parseFrontmatter('---\nrenewalDate: "2026-09-01"\n---\n')
    expect(parsed).not.toBeNull()
    expect(typeof parsed?.renewalDate).toBe('string')
    expect(parsed?.renewalDate).toBe('2026-09-01')
  })

  it('keeps unquoted ISO date strings as strings', () => {
    const parsed = parseFrontmatter('---\nrenewalDate: 2026-09-01\n---\n')
    expect(parsed).not.toBeNull()
    expect(typeof parsed?.renewalDate).toBe('string')
  })

  it('treats explicit null as null and absent keys as undefined', () => {
    const parsed = parseFrontmatter('---\nphone: null\n---\n')
    expect(parsed).not.toBeNull()
    expect(parsed?.phone).toBeNull()
    expect('email' in (parsed as ParsedProfile)).toBe(false)
  })

  it('parses nested attributes block', () => {
    const parsed = parseFrontmatter('---\nattributes:\n  industry: "logistics"\n  employeeCount: 120\n---\n')
    expect(parsed?.attributes).toEqual({ industry: 'logistics', employeeCount: 120 })
  })

  it('round-trips renderContactFrontmatter into a fixed point', () => {
    const c = makeContact()
    const rendered = renderContactFrontmatter(c)
    const parsed = parseFrontmatter(rendered)
    expect(parsed).not.toBeNull()
    expect(parsed?.displayName).toBe('Marcus Tan')
    expect(parsed?.email).toBe('marcus@northwind.sg')
    expect(parsed?.phone).toBe('+6591234567')
    expect(parsed?.segments).toEqual(['enterprise', 'renewal-q3'])
    expect(parsed?.marketingOptOut).toBe(false)
    expect(parsed?.attributes).toEqual({
      industry: 'logistics',
      employeeCount: 120,
      renewalDate: '2026-09-01',
    })
  })
})

describe('diffProfile', () => {
  it('reports no diff when current matches baseline', () => {
    const c = makeContact()
    const rendered = renderContactFrontmatter(c)
    const parsed = parseFrontmatter(rendered) as ParsedProfile
    const diff = diffProfile(parsed, parsed)
    expect(Object.keys(diff.fields)).toHaveLength(0)
  })

  it('reports an empty diff when only attribute key order changed', () => {
    const baseline: ParsedProfile = {
      displayName: 'Marcus',
      attributes: { alpha: 'a', beta: 'b' },
    }
    const current: ParsedProfile = {
      displayName: 'Marcus',
      attributes: { beta: 'b', alpha: 'a' },
    }
    const diff = diffProfile(baseline, current)
    expect(Object.keys(diff.fields)).toHaveLength(0)
  })

  it('reports one entry per changed top-level scalar', () => {
    const baseline: ParsedProfile = { displayName: 'Old', email: 'old@x.com' }
    const current: ParsedProfile = { displayName: 'New', email: 'old@x.com' }
    const diff = diffProfile(baseline, current)
    expect(diff.fields).toEqual({ displayName: { from: 'Old', to: 'New' } })
  })

  it('flattens attributes.* keys with a literal dot prefix', () => {
    const baseline: ParsedProfile = { attributes: { industry: 'tech' } }
    const current: ParsedProfile = { attributes: { industry: 'logistics' } }
    const diff = diffProfile(baseline, current)
    expect(diff.fields).toEqual({
      'attributes.industry': { from: 'tech', to: 'logistics' },
    })
  })

  it('treats absent keys in current as no-ops', () => {
    const baseline: ParsedProfile = { displayName: 'Old', phone: '+1' }
    const current: ParsedProfile = { displayName: 'Old' }
    const diff = diffProfile(baseline, current)
    expect(Object.keys(diff.fields)).toHaveLength(0)
  })

  it('emits to:null when current has explicit null against non-null baseline', () => {
    const baseline: ParsedProfile = { phone: '+1' }
    const current: ParsedProfile = { phone: null }
    const diff = diffProfile(baseline, current)
    expect(diff.fields).toEqual({ phone: { from: '+1', to: null } })
  })

  it('detects new attributes that did not exist in the baseline', () => {
    const baseline: ParsedProfile = { attributes: {} }
    const current: ParsedProfile = { attributes: { renewalDate: '2026-09-01' } }
    const diff = diffProfile(baseline, current)
    expect(diff.fields).toEqual({
      'attributes.renewalDate': { from: null, to: '2026-09-01' },
    })
  })

  it('detects array changes in segments', () => {
    const baseline: ParsedProfile = { segments: ['standard'] }
    const current: ParsedProfile = { segments: ['enterprise', 'renewal-q3'] }
    const diff = diffProfile(baseline, current)
    expect(diff.fields.segments).toEqual({
      from: ['standard'],
      to: ['enterprise', 'renewal-q3'],
    })
  })
})
