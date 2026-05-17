/**
 * Tests for the 5 new WakeTrigger render functions added in US-006 (Slice B.1).
 *
 * Group A — purity / determinism: same payload → same output bytes; different
 * refs that the renderer ignores do not alter output.
 *
 * Group B — forbidden-payload-content lint: render bodies contain no calls to
 * Date.now(), new Date(), nanoid(), randomUUID(), or process.env.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'

import { resolveTriggerSpec } from './trigger'

// ─── Shared sample refs ──────────────────────────────────────────────────────

const REFS = {
  contactId: 'ct0test',
  channelInstanceId: 'ch0web',
  assignee: 'agent:agt0abc',
  currentAgentId: 'agt0abc',
}

const REFS_ALT = {
  contactId: 'ct0test',
  channelInstanceId: 'ch0web',
  // Different assignee — renderers that don't read `assignee` must produce identical output.
  assignee: 'agent:agt0different',
  currentAgentId: 'agt0different',
}

// ─── A. Purity / determinism ─────────────────────────────────────────────────

describe('renderConversationReassigned — purity', () => {
  const spec = resolveTriggerSpec('conversation_reassigned')

  const trigger = {
    trigger: 'conversation_reassigned' as const,
    conversationId: 'cv0test',
    fromAssignee: 'agent:agt0old',
    toAssignee: 'agent:agt0new',
    reason: 'shift handover',
  }

  it('produces identical output on two calls with identical payload', () => {
    const a = spec.render(trigger, REFS)
    const b = spec.render(trigger, REFS)
    expect(a).toBe(b)
  })

  it('different refs.assignee does not affect output (renderer reads only refs.contactId + channelInstanceId)', () => {
    const a = spec.render(trigger, REFS)
    const b = spec.render(trigger, REFS_ALT)
    expect(a).toBe(b)
  })

  it('uses (unassigned) when fromAssignee is null', () => {
    const text = spec.render({ ...trigger, fromAssignee: null }, REFS)
    expect(text).toContain('from (unassigned) to agent:agt0new')
  })

  it('omits reason clause when reason is absent', () => {
    const { reason: _r, ...noReason } = trigger
    const text = spec.render(noReason, REFS)
    expect(text).not.toContain('Reason:')
    expect(text).toContain('from agent:agt0old to agent:agt0new')
  })

  it('includes reason clause when reason is present', () => {
    const text = spec.render(trigger, REFS)
    expect(text).toContain('Reason: shift handover.')
  })

  it('includes CONVERSATION.md pointer', () => {
    const text = spec.render(trigger, REFS)
    expect(text).toContain('CONVERSATION.md')
  })
})

describe('renderApprovalFiled — purity', () => {
  const spec = resolveTriggerSpec('approval_filed')

  const trigger = {
    trigger: 'approval_filed' as const,
    conversationId: 'cv0test',
    approvalId: 'apr0abc',
    approvalSummary: 'Issue a $500 refund to Alice',
    filedByAgentId: 'agt0abc',
  }

  it('produces identical output on two calls with identical payload', () => {
    const a = spec.render(trigger, REFS)
    const b = spec.render(trigger, REFS)
    expect(a).toBe(b)
  })

  it('different refs.assignee does not affect output', () => {
    const a = spec.render(trigger, REFS)
    const b = spec.render(trigger, REFS_ALT)
    expect(a).toBe(b)
  })

  it('contains the approval summary', () => {
    const text = spec.render(trigger, REFS)
    expect(text).toContain('Issue a $500 refund to Alice')
  })
})

describe('renderApprovalDecided — purity', () => {
  const spec = resolveTriggerSpec('approval_decided')

  const trigger = {
    trigger: 'approval_decided' as const,
    conversationId: 'cv0test',
    approvalId: 'apr0abc',
    decision: 'approve' as const,
    decidedByLabel: 'staff Bob',
    filedByAgentId: 'agt0abc',
    note: 'Looks good',
  }

  it('produces identical output on two calls with identical payload', () => {
    const a = spec.render(trigger, REFS)
    const b = spec.render(trigger, REFS)
    expect(a).toBe(b)
  })

  it('different refs.assignee does not affect output', () => {
    const a = spec.render(trigger, REFS)
    const b = spec.render(trigger, REFS_ALT)
    expect(a).toBe(b)
  })

  it('contains approvalId and decidedByLabel', () => {
    const text = spec.render(trigger, REFS)
    expect(text).toContain('apr0abc')
    expect(text).toContain('staff Bob')
  })

  it('includes note when present', () => {
    const text = spec.render(trigger, REFS)
    expect(text).toContain(': Looks good')
  })

  it('omits note suffix when note is absent', () => {
    const { note: _n, ...noNote } = trigger
    const text = spec.render(noNote, REFS)
    expect(text).not.toContain(':')
    expect(text).toContain('approve by staff Bob')
  })
})

describe('renderProposalFiled — purity', () => {
  const spec = resolveTriggerSpec('proposal_filed')

  const trigger = {
    trigger: 'proposal_filed' as const,
    conversationId: 'cv0test',
    proposalId: 'prp0abc',
    proposalSummary: 'Update Alice email to alice@new.com',
    resourceModule: 'contacts',
    resourceType: 'contact',
    proposedByAgentId: 'agt0abc',
  }

  it('produces identical output on two calls with identical payload', () => {
    const a = spec.render(trigger, REFS)
    const b = spec.render(trigger, REFS)
    expect(a).toBe(b)
  })

  it('different refs.assignee does not affect output', () => {
    const a = spec.render(trigger, REFS)
    const b = spec.render(trigger, REFS_ALT)
    expect(a).toBe(b)
  })

  it('contains proposalSummary and resource coordinates', () => {
    const text = spec.render(trigger, REFS)
    expect(text).toContain('Update Alice email to alice@new.com')
    expect(text).toContain('contacts/contact')
  })
})

describe('renderProposalDecided — purity', () => {
  const spec = resolveTriggerSpec('proposal_decided')

  const triggerBound = {
    trigger: 'proposal_decided' as const,
    conversationId: 'cv0test',
    proposalId: 'prp0abc',
    decision: 'approve' as const,
    proposedByAgentId: 'agt0abc',
    note: 'Done',
  }

  const triggerUnbound = {
    trigger: 'proposal_decided' as const,
    conversationId: null,
    proposalId: 'prp0xyz',
    decision: 'reject' as const,
    proposedByAgentId: 'agt0abc',
  }

  it('produces identical output on two calls with identical payload (conversation-bound)', () => {
    const a = spec.render(triggerBound, REFS)
    const b = spec.render(triggerBound, REFS)
    expect(a).toBe(b)
  })

  it('produces identical output on two calls with identical payload (unbound)', () => {
    const a = spec.render(triggerUnbound, REFS)
    const b = spec.render(triggerUnbound, REFS)
    expect(a).toBe(b)
  })

  it('different refs.assignee does not affect output', () => {
    const a = spec.render(triggerBound, REFS)
    const b = spec.render(triggerBound, REFS_ALT)
    expect(a).toBe(b)
  })

  it('conversation-bound variant includes customer-reply hint', () => {
    const text = spec.render(triggerBound, REFS)
    expect(text).toContain('Reply to the customer if appropriate')
  })

  it('unbound variant does NOT include customer-reply hint', () => {
    const text = spec.render(triggerUnbound, REFS)
    expect(text).not.toContain('Reply to the customer')
  })

  it('includes note when present', () => {
    const text = spec.render(triggerBound, REFS)
    expect(text).toContain(': Done')
  })
})

// ─── B. Forbidden-payload-content lint ───────────────────────────────────────

describe('forbidden-payload-content lint — new render bodies in trigger.ts', () => {
  // Read the full source and extract bodies of the 5 new render functions only.
  // We delimit each new function from "function render<Name>(" to the next
  // "function render" or end-of-REGISTRY comment, then grep only those slices.

  const src = readFileSync(new URL('./trigger.ts', import.meta.url).pathname, 'utf8')

  const NEW_FUNCTIONS = [
    'renderConversationReassigned',
    'renderApprovalFiled',
    'renderApprovalDecided',
    'renderProposalFiled',
    'renderProposalDecided',
  ] as const

  /**
   * Extract the body of a named function from the source.
   * Captures from `function <name>(` through to the closing `}` at column 0.
   */
  function extractFunctionBody(source: string, name: string): string {
    const startIdx = source.indexOf(`function ${name}(`)
    if (startIdx === -1) throw new Error(`Function ${name} not found in trigger.ts`)
    // Find the next top-level `function ` or end of registry comment to bound the slice.
    const afterStart = source.indexOf('\n', startIdx) + 1
    // Scan forward for the closing `}` at column 0 (function end).
    let depth = 0
    let i = startIdx
    while (i < source.length) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') {
        depth--
        if (depth === 0) {
          return source.slice(startIdx, i + 1)
        }
      }
      i++
    }
    return source.slice(afterStart)
  }

  const bodies = NEW_FUNCTIONS.map((name) => ({ name, body: extractFunctionBody(src, name) }))

  for (const { name, body } of bodies) {
    it(`${name} does not call Date.now()`, () => {
      expect(body).not.toMatch(/Date\.now\(/)
    })

    it(`${name} does not call new Date()`, () => {
      // Allow `new Date` only inside TS type annotations (none expected in these functions).
      expect(body).not.toMatch(/new Date\(/)
    })

    it(`${name} does not call nanoid()`, () => {
      expect(body).not.toMatch(/nanoid\(/)
    })

    it(`${name} does not call randomUUID()`, () => {
      expect(body).not.toMatch(/randomUUID\(/)
    })

    it(`${name} does not access process.env`, () => {
      expect(body).not.toMatch(/process\.env/)
    })
  }
})
