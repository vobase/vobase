import { describe, expect, it } from 'bun:test'
import { applyTransition, InvalidTransitionError, isTerminal, type TransitionTable } from './apply-transition'

type ConvStatus = 'active' | 'resolving' | 'resolved' | 'archived'

const table: TransitionTable<ConvStatus> = {
  transitions: [
    { from: 'active', to: 'resolving' },
    { from: 'resolving', to: 'resolved' },
    { from: 'resolved', to: 'archived' },
    { from: 'active', to: 'resolved' },
  ],
  terminal: ['archived'],
}

describe('applyTransition', () => {
  it('accepts listed edges', () => {
    expect(applyTransition(table, 'active', 'resolving')).toBe('resolving')
    expect(applyTransition(table, 'resolving', 'resolved')).toBe('resolved')
  })

  it('rejects unlisted edges with line-accurate InvalidTransitionError', () => {
    expect(() => applyTransition(table, 'resolving', 'archived', 'conversations')).toThrow(InvalidTransitionError)
  })

  it('is a no-op when from === to', () => {
    expect(applyTransition(table, 'active', 'active')).toBe('active')
  })

  it('terminal states cannot transition', () => {
    expect(() => applyTransition(table, 'archived', 'active')).toThrow(InvalidTransitionError)
    expect(isTerminal(table, 'archived')).toBe(true)
    expect(isTerminal(table, 'active')).toBe(false)
  })
})
