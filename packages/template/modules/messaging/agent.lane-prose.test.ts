/**
 * Unit tests for the lane-aware AGENTS.md contributors in `modules/messaging/agent.ts`.
 *
 * The contributors read wake-time facts (lane, triggerKind) from
 * `IndexContributorContext.scratch` via `getWakeAgentsMdScratch`. These tests
 * assert each contributor renders only when its condition is met and stays
 * silent (returns `null`) otherwise — including the "no scratch" case (e.g.
 * AGENTS.md preview without a synthetic wake context).
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

const STAFF_NOTE = findContributor('messaging.staff-note')
const STANDALONE = findContributor('messaging.standalone-no-customer')

describe('messaging staff-note contributor', () => {
  it('emits the staff-note block on staff-note wakes', () => {
    const out = STAFF_NOTE.render(ctxFor({ lane: 'conversation', triggerKind: 'staff_note' }))
    expect(out).not.toBeNull()
    expect(out).toContain('Staff note')
    expect(out).toContain('/contacts/<id>/MEMORY.md')
    expect(out).toContain('/agents/<id>/MEMORY.md')
    expect(out).toContain('/staff/<staffId>/MEMORY.md')
    expect(out).toContain('add_note')
  })

  it('returns null on inbound_message wake', () => {
    const out = STAFF_NOTE.render(ctxFor({ lane: 'conversation', triggerKind: 'inbound_message' }))
    expect(out).toBeNull()
  })

  it('returns null on standalone wake', () => {
    const out = STAFF_NOTE.render(ctxFor({ lane: 'standalone', triggerKind: 'operator_thread' }))
    expect(out).toBeNull()
  })

  it('returns null when no wake scratch is present (preview mode)', () => {
    expect(STAFF_NOTE.render(ctxFor(undefined))).toBeNull()
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
