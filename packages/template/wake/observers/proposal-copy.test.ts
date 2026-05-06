/**
 * Unit tests for the SME-friendly proposal-copy builders. These cover the
 * exact inbox surface non-technical staff read in `<ProsePanel>` (Problem +
 * Outcome). The earlier hardcoded copy ("profile.md frontmatter edit",
 * "Captured staff signal: supervisor") leaked harness jargon — the
 * regressions guarded here keep that from coming back.
 */

import { describe, expect, it } from 'bun:test'

import { type AttrLabelMap, buildFieldSetCopy, buildStaffSignalCopy } from './proposal-copy'

const NO_LABELS: AttrLabelMap = new Map()

describe('buildFieldSetCopy — rationale', () => {
  it('names the agent + subject + count, singular/plural correct', () => {
    const oneFieldCopy = buildFieldSetCopy({
      subjectName: 'Marcus Quasar',
      subjectNoun: 'contact',
      agentName: 'MeriGPT',
      fields: { 'attributes.company': { from: null, to: 'Quasar Robotics' } },
      requiresApproval: false,
    })
    expect(oneFieldCopy.rationale).toBe('MeriGPT picked up 1 new detail about Marcus Quasar during the conversation.')

    const manyFieldsCopy = buildFieldSetCopy({
      subjectName: 'Marcus Quasar',
      subjectNoun: 'contact',
      agentName: 'MeriGPT',
      fields: {
        'attributes.company': { from: null, to: 'Quasar Robotics' },
        'attributes.employeeCount': { from: null, to: 240 },
      },
      requiresApproval: false,
    })
    expect(manyFieldsCopy.rationale).toBe(
      'MeriGPT picked up 2 new details about Marcus Quasar during the conversation.',
    )
  })

  it('falls back to "The agent" when agentName is missing or blank', () => {
    const copy = buildFieldSetCopy({
      subjectName: 'Marcus',
      subjectNoun: 'contact',
      agentName: '   ',
      fields: { 'attributes.company': { from: null, to: 'A' } },
      requiresApproval: false,
    })
    expect(copy.rationale.startsWith('The agent picked up')).toBe(true)
  })

  it('appends the field-gate note when a gated key is touched', () => {
    const copy = buildFieldSetCopy({
      subjectName: 'Marcus Quasar',
      subjectNoun: 'contact',
      agentName: 'MeriGPT',
      fields: { email: { from: null, to: 'marcus@quasar.io' } },
      requiresApproval: false,
      requiresApprovalForFields: new Set(['displayName', 'email']),
    })
    expect(copy.rationale).toContain('sensitive fields, so the batch needs your sign-off')
  })

  it('appends the staff-record note when the resource always queues', () => {
    const copy = buildFieldSetCopy({
      subjectName: 'Bob',
      subjectNoun: 'staff member',
      agentName: 'MeriGPT',
      fields: { title: { from: 'Solutions Engineer', to: 'VP Engineering' } },
      requiresApproval: true,
    })
    expect(copy.rationale).toContain('staff records always need your sign-off')
  })

  it('omits the gate note when nothing queues', () => {
    const copy = buildFieldSetCopy({
      subjectName: 'Marcus',
      subjectNoun: 'contact',
      agentName: 'MeriGPT',
      fields: { 'attributes.company': { from: null, to: 'Quasar Robotics' } },
      requiresApproval: false,
    })
    expect(copy.rationale.endsWith('during the conversation.')).toBe(true)
  })
})

describe('buildFieldSetCopy — expected outcome', () => {
  it('uses past-tense "Saved" for auto-applied changes and future-tense "If you approve" when queued', () => {
    const auto = buildFieldSetCopy({
      subjectName: 'Marcus',
      subjectNoun: 'contact',
      agentName: 'MeriGPT',
      fields: { 'attributes.company': { from: null, to: 'Quasar' } },
      requiresApproval: false,
    })
    expect(auto.expectedOutcome.startsWith('Saved the following on Marcus’s contact profile:')).toBe(true)

    const queued = buildFieldSetCopy({
      subjectName: 'Bob',
      subjectNoun: 'staff member',
      agentName: 'MeriGPT',
      fields: { title: { from: 'A', to: 'B' } },
      requiresApproval: true,
    })
    expect(
      queued.expectedOutcome.startsWith('If you approve, we will save the following on Bob’s staff member profile:'),
    ).toBe(true)
  })

  it('renders one bullet per field with new value when prior was empty', () => {
    const copy = buildFieldSetCopy({
      subjectName: 'Marcus',
      subjectNoun: 'contact',
      agentName: 'MeriGPT',
      fields: {
        'attributes.company': { from: null, to: 'Quasar Robotics' },
        'attributes.employeeCount': { from: null, to: 240 },
      },
      requiresApproval: false,
    })
    expect(copy.expectedOutcome).toContain('• Company: Quasar Robotics')
    expect(copy.expectedOutcome).toContain('• Employee count: 240')
    expect(copy.expectedOutcome).not.toContain('(was')
  })

  it('shows "X (was Y)" when the prior value was non-empty', () => {
    const copy = buildFieldSetCopy({
      subjectName: 'Bob',
      subjectNoun: 'staff member',
      agentName: 'MeriGPT',
      fields: { title: { from: 'Solutions Engineer', to: 'VP Engineering' } },
      requiresApproval: true,
    })
    expect(copy.expectedOutcome).toContain('• Title: VP Engineering (was Solutions Engineer)')
  })

  it('formats arrays as comma-joined strings, with em-dash for empty', () => {
    const copy = buildFieldSetCopy({
      subjectName: 'Marcus',
      subjectNoun: 'contact',
      agentName: 'MeriGPT',
      fields: {
        segments: { from: ['enterprise'], to: ['enterprise', 'renewal-q3'] },
        sectors: { from: ['retail'], to: [] },
      },
      requiresApproval: false,
    })
    expect(copy.expectedOutcome).toContain('• Segments: enterprise, renewal-q3 (was enterprise)')
    expect(copy.expectedOutcome).toContain('• Sectors: — (was retail)')
  })

  it('formats booleans as Yes/No', () => {
    const copy = buildFieldSetCopy({
      subjectName: 'Marcus',
      subjectNoun: 'contact',
      agentName: 'MeriGPT',
      fields: {
        marketingOptOut: { from: false, to: true },
      },
      requiresApproval: false,
    })
    expect(copy.expectedOutcome).toContain('• Marketing opt-out: Yes (was No)')
  })

  it('formats YYYY-MM-DD dates as "1 Sep 2026"', () => {
    const copy = buildFieldSetCopy({
      subjectName: 'Marcus',
      subjectNoun: 'contact',
      agentName: 'MeriGPT',
      fields: {
        'attributes.renewalDate': { from: null, to: '2026-09-01' },
      },
      requiresApproval: false,
    })
    expect(copy.expectedOutcome).toContain('• Renewal date: 1 Sep 2026')
  })

  it('uses attribute-definition labels and types when available', () => {
    const labels: AttrLabelMap = new Map([
      ['renewal_date', { label: 'Renewal date', type: 'date' }],
      ['plan_tier', { label: 'Plan', type: 'enum' }],
    ])
    const copy = buildFieldSetCopy({
      subjectName: 'Marcus',
      subjectNoun: 'contact',
      agentName: 'MeriGPT',
      fields: {
        'attributes.renewal_date': { from: null, to: '2026-09-01' },
        'attributes.plan_tier': { from: null, to: 'pro' },
      },
      requiresApproval: false,
      attrLabels: labels,
    })
    expect(copy.expectedOutcome).toContain('• Renewal date: 1 Sep 2026')
    expect(copy.expectedOutcome).toContain('• Plan: pro')
  })

  it('humanises unknown attribute keys (camelCase + snake_case) without crashing', () => {
    const copy = buildFieldSetCopy({
      subjectName: 'Marcus',
      subjectNoun: 'contact',
      agentName: 'MeriGPT',
      fields: {
        'attributes.priorityFlag': { from: null, to: 'high' },
        'attributes.lifetime_value': { from: null, to: 50000 },
      },
      requiresApproval: false,
      attrLabels: NO_LABELS,
    })
    expect(copy.expectedOutcome).toContain('• Priority flag: high')
    expect(copy.expectedOutcome).toContain('• Lifetime value: 50000')
  })

  it('renders null-to as em-dash, with prior value preserved', () => {
    const copy = buildFieldSetCopy({
      subjectName: 'Marcus',
      subjectNoun: 'contact',
      agentName: 'MeriGPT',
      fields: { phone: { from: '+6591234567', to: null } },
      requiresApproval: false,
    })
    expect(copy.expectedOutcome).toContain('• Phone: — (was +6591234567)')
  })

  it('never leaks "frontmatter" or "row" terminology', () => {
    const copy = buildFieldSetCopy({
      subjectName: 'Marcus',
      subjectNoun: 'contact',
      agentName: 'MeriGPT',
      fields: { 'attributes.company': { from: null, to: 'Quasar' } },
      requiresApproval: false,
    })
    expect(copy.rationale.toLowerCase()).not.toContain('frontmatter')
    expect(copy.rationale.toLowerCase()).not.toContain('profile.md')
    expect(copy.rationale.toLowerCase()).not.toContain('row')
    expect(copy.expectedOutcome.toLowerCase()).not.toContain('frontmatter')
    expect(copy.expectedOutcome.toLowerCase()).not.toContain('profile.md')
  })
})

describe('buildStaffSignalCopy', () => {
  it('renders supervisor signals naming the actor + agent', () => {
    const copy = buildStaffSignalCopy({
      agentName: 'MeriGPT',
      signalKind: 'supervisor',
      actorName: 'Bob',
      notePreview: 'Always confirm refunds with Carol first.',
    })
    expect(copy.rationale).toBe(
      'Bob pinged MeriGPT with a coaching note in this conversation. Filing it as a lesson so MeriGPT remembers it next time.',
    )
    expect(copy.expectedOutcome).toContain('MeriGPT will keep this in mind on future conversations.')
    expect(copy.expectedOutcome).toContain('“Always confirm refunds with Carol first.”')
  })

  it('falls back to "A teammate" when actor is unknown', () => {
    const copy = buildStaffSignalCopy({
      agentName: 'MeriGPT',
      signalKind: 'internal_note',
    })
    expect(copy.rationale.startsWith('A teammate left MeriGPT an internal note')).toBe(true)
    expect(copy.expectedOutcome).not.toContain('“')
  })

  it('uses the right verb for approval_rejected', () => {
    const copy = buildStaffSignalCopy({
      agentName: 'MeriGPT',
      signalKind: 'approval_rejected',
      actorName: 'Carol',
      notePreview: 'Wrong refund window.',
    })
    expect(copy.rationale).toContain('Carol rejected an action MeriGPT proposed.')
  })

  it('never leaks "staff signal" or kind tokens', () => {
    const copy = buildStaffSignalCopy({
      agentName: 'MeriGPT',
      signalKind: 'supervisor',
      actorName: 'Bob',
      notePreview: 'noted',
    })
    expect(copy.rationale.toLowerCase()).not.toContain('staff signal')
    expect(copy.rationale.toLowerCase()).not.toContain('supervisor')
    expect(copy.expectedOutcome.toLowerCase()).not.toContain('working memory')
  })
})
