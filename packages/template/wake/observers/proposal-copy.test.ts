/**
 * Unit tests for the SME-friendly proposal-copy builder. Covers the inbox
 * surface non-technical staff read in `<ProsePanel>` (Problem + Outcome).
 *
 * `buildFieldSetCopy` was removed alongside the workspace-sync `field_set`
 * flush path; the remaining surface is `buildStaffSignalCopy`, used by
 * `learning-proposals` to attribute supervisor / internal-note signals.
 */

import { describe, expect, it } from 'bun:test'

import { buildStaffSignalCopy } from './proposal-copy'

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
