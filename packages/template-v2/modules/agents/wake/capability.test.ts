import { describe, expect, it } from 'bun:test'

import { conversationTools } from '../tools/conversation'
import { standaloneTools } from '../tools/standalone'
import { resolveCapability } from './capability'

describe('resolveCapability', () => {
  it('routes inbound_message to the conversation lane', () => {
    const cap = resolveCapability('inbound_message')
    expect(cap.lane).toBe('conversation')
    expect(cap.logPrefix).toBe('wake:conv')
    expect(cap.tools).toBe(conversationTools)
  })

  it('routes supervisor to the conversation lane', () => {
    const cap = resolveCapability('supervisor')
    expect(cap.lane).toBe('conversation')
    expect(cap.logPrefix).toBe('wake:conv')
    expect(cap.tools).toBe(conversationTools)
  })

  it('routes approval_resumed to the conversation lane', () => {
    const cap = resolveCapability('approval_resumed')
    expect(cap.lane).toBe('conversation')
    expect(cap.logPrefix).toBe('wake:conv')
  })

  it('routes scheduled_followup to the conversation lane', () => {
    const cap = resolveCapability('scheduled_followup')
    expect(cap.lane).toBe('conversation')
    expect(cap.logPrefix).toBe('wake:conv')
  })

  it('routes manual to the conversation lane', () => {
    const cap = resolveCapability('manual')
    expect(cap.lane).toBe('conversation')
    expect(cap.logPrefix).toBe('wake:conv')
  })

  it('routes operator_thread to the standalone lane', () => {
    const cap = resolveCapability('operator_thread')
    expect(cap.lane).toBe('standalone')
    expect(cap.logPrefix).toBe('wake:solo')
    expect(cap.tools).toBe(standaloneTools)
  })

  it('routes heartbeat to the standalone lane', () => {
    const cap = resolveCapability('heartbeat')
    expect(cap.lane).toBe('standalone')
    expect(cap.logPrefix).toBe('wake:solo')
    expect(cap.tools).toBe(standaloneTools)
  })
})
