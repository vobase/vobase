/**
 * Unit tests for the lane-aware AGENTS.md contributors in `modules/messaging/agent.ts`.
 *
 * The contributors read wake-time facts (lane, triggerKind, supervisorKind)
 * from `IndexContributorContext.scratch` via `getWakeAgentsMdScratch`. These
 * tests assert each contributor renders only when its condition is met and
 * stays silent (returns `null`) otherwise — including the "no scratch" case
 * (e.g. AGENTS.md preview without a synthetic wake context).
 */

import { describe, expect, it } from 'bun:test'
import type { IndexContributor, IndexContributorContext } from '@vobase/core'

import { buildWakeAgentsMdScratch, type WakeAgentsMdScratch } from '~/wake/agents-md-scratch'
import { messagingAgentsMdContributors } from './agent'

function findContributor(name: string): IndexContributor {
  const c = messagingAgentsMdContributors.find((x) => x.name === name)
  if (!c) throw new Error(`contributor ${name} not registered`)
  return c
}

function ctxFor(scratchValue: WakeAgentsMdScratch | undefined): IndexContributorContext {
  return {
    file: 'AGENTS.md',
    scratch: scratchValue ? buildWakeAgentsMdScratch(scratchValue) : undefined,
  }
}

const COACHING = findContributor('messaging.supervisor-coaching')
const ASK_STAFF = findContributor('messaging.supervisor-ask-staff-answer')
const STANDALONE = findContributor('messaging.standalone-no-customer')

describe('messaging supervisor-coaching contributor', () => {
  it('emits the 1-2-3 block on coaching wake', () => {
    const out = COACHING.render(ctxFor({ lane: 'conversation', triggerKind: 'supervisor', supervisorKind: 'coaching' }))
    expect(out).not.toBeNull()
    expect(out).toContain('coaching')
    expect(out).toContain('Customer-facing tools')
    expect(out).toContain('/contacts/<contactId>/MEMORY.md')
    expect(out).toContain('/agents/<your-id>/MEMORY.md')
    expect(out).toContain('/staff/<staffId>/MEMORY.md')
    expect(out).toContain('add_note')
  })

  it('returns null on ask_staff_answer wake', () => {
    const out = COACHING.render(
      ctxFor({ lane: 'conversation', triggerKind: 'supervisor', supervisorKind: 'ask_staff_answer' }),
    )
    expect(out).toBeNull()
  })

  it('returns null on inbound_message wake', () => {
    const out = COACHING.render(ctxFor({ lane: 'conversation', triggerKind: 'inbound_message' }))
    expect(out).toBeNull()
  })

  it('returns null on standalone wake', () => {
    const out = COACHING.render(ctxFor({ lane: 'standalone', triggerKind: 'operator_thread' }))
    expect(out).toBeNull()
  })

  it('returns null when no wake scratch is present (preview mode)', () => {
    expect(COACHING.render(ctxFor(undefined))).toBeNull()
  })
})

describe('messaging supervisor-ask-staff-answer contributor', () => {
  it('emits the relay block on ask_staff_answer wake', () => {
    const out = ASK_STAFF.render(
      ctxFor({ lane: 'conversation', triggerKind: 'supervisor', supervisorKind: 'ask_staff_answer' }),
    )
    expect(out).not.toBeNull()
    expect(out).toContain('relay the answer')
    expect(out).toContain('reply')
    expect(out).toContain('send_card')
  })

  it('returns null on coaching wake', () => {
    const out = ASK_STAFF.render(
      ctxFor({ lane: 'conversation', triggerKind: 'supervisor', supervisorKind: 'coaching' }),
    )
    expect(out).toBeNull()
  })

  it('returns null on standalone wake', () => {
    const out = ASK_STAFF.render(ctxFor({ lane: 'standalone', triggerKind: 'heartbeat' }))
    expect(out).toBeNull()
  })

  it('returns null when no wake scratch is present', () => {
    expect(ASK_STAFF.render(ctxFor(undefined))).toBeNull()
  })
})

describe('messaging standalone-no-customer contributor', () => {
  it('emits the no-customer block on standalone operator_thread', () => {
    const out = STANDALONE.render(ctxFor({ lane: 'standalone', triggerKind: 'operator_thread' }))
    expect(out).not.toBeNull()
    expect(out).toContain('No customer is on the line')
    expect(out).toContain('add_note')
  })

  it('emits the no-customer block on standalone heartbeat', () => {
    const out = STANDALONE.render(ctxFor({ lane: 'standalone', triggerKind: 'heartbeat' }))
    expect(out).not.toBeNull()
    expect(out).toContain('No customer is on the line')
  })

  it('returns null on conversation lane', () => {
    expect(STANDALONE.render(ctxFor({ lane: 'conversation', triggerKind: 'inbound_message' }))).toBeNull()
  })

  it('returns null when no wake scratch is present', () => {
    expect(STANDALONE.render(ctxFor(undefined))).toBeNull()
  })
})
