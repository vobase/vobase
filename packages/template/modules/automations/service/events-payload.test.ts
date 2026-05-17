/**
 * Payload-shape contract for the 5 notification events registered in US-008
 * (Slice B.3). Each event must accept a well-formed payload and reject any
 * payload missing a required field.
 *
 * The full dispatch-side wake assertion (rule cache → pg-boss send →
 * standalone wake) is deferred to US-013 per plan §5.2 — the dispatcher is a
 * `throw 'not implemented'` stub today. This file proves the Zod registry is
 * wired correctly so US-013 can build on a known-good contract.
 */

import { describe, expect, it } from 'bun:test'

import { type EventName, eventRegistry } from './registry'

interface PayloadCase {
  name: EventName
  valid: Record<string, unknown>
  invalid: Record<string, unknown>
}

const cases: PayloadCase[] = [
  {
    name: 'conversation_reassigned',
    valid: {
      conversationId: 'conv-1',
      organizationId: 'org-1',
      fromAssignee: 'agent:agt0aaa',
      toAssignee: 'agent:agt0bbb',
      reason: 'load balance',
    },
    // missing toAssignee
    invalid: { conversationId: 'conv-1', organizationId: 'org-1', fromAssignee: null },
  },
  {
    name: 'approval_filed',
    valid: {
      conversationId: 'conv-1',
      organizationId: 'org-1',
      approvalId: 'app-1',
      approvalSummary: 'Approve refund of $42 to customer X',
      filedByAgentId: 'agt0aaa',
      assigneeStaffUserId: null,
    },
    // missing filedByAgentId
    invalid: {
      conversationId: 'conv-1',
      organizationId: 'org-1',
      approvalId: 'app-1',
      approvalSummary: 's',
      assigneeStaffUserId: null,
    },
  },
  {
    name: 'approval_decided',
    valid: {
      conversationId: 'conv-1',
      organizationId: 'org-1',
      approvalId: 'app-1',
      decision: 'approve',
      decidedByUserId: 'usr0xyz0',
      decidedByLabel: 'staff usr0xyz0',
      filedByAgentId: 'agt0aaa',
    },
    // decision not in enum
    invalid: {
      conversationId: 'conv-1',
      organizationId: 'org-1',
      approvalId: 'app-1',
      decision: 'maybe',
      decidedByUserId: 'usr0xyz0',
      decidedByLabel: 'staff x',
      filedByAgentId: 'agt0aaa',
    },
  },
  {
    name: 'proposal_filed',
    valid: {
      conversationId: 'conv-1',
      organizationId: 'org-1',
      proposalId: 'prop-1',
      proposalSummary: 'Update contact phone',
      resourceModule: 'contacts',
      resourceType: 'contact',
      proposedByAgentId: 'agt0aaa',
    },
    // missing resourceModule
    invalid: {
      conversationId: null,
      organizationId: 'org-1',
      proposalId: 'prop-1',
      proposalSummary: 's',
      resourceType: 'contact',
      proposedByAgentId: 'agt0aaa',
    },
  },
  {
    name: 'proposal_decided',
    valid: {
      conversationId: null,
      organizationId: 'org-1',
      proposalId: 'prop-1',
      decision: 'reject',
      proposedByAgentId: 'agt0aaa',
      decidedByUserId: 'usr0xyz0',
      note: 'wrong field',
    },
    // proposedByAgentId missing
    invalid: {
      conversationId: 'conv-1',
      organizationId: 'org-1',
      proposalId: 'prop-1',
      decision: 'approve',
      decidedByUserId: 'usr0xyz0',
    },
  },
]

describe('eventRegistry payload contracts (US-008)', () => {
  for (const c of cases) {
    it(`${c.name} accepts a well-formed payload`, () => {
      const schema = eventRegistry[c.name]
      expect(() => schema.parse(c.valid)).not.toThrow()
    })

    it(`${c.name} rejects a malformed payload (missing required field)`, () => {
      const schema = eventRegistry[c.name]
      expect(() => schema.parse(c.invalid)).toThrow()
    })
  }

  it('cron remains registered (US-004 baseline)', () => {
    expect(() =>
      eventRegistry.cron.parse({ scheduleId: 'sched-1', intendedRunAt: '2026-05-17T00:00:00Z' }),
    ).not.toThrow()
  })
})
