import { describe, expect, test } from 'bun:test'

import { conversationCommands } from './conversation'

describe('conversationCommands registry', () => {
  test('exports all 10 commands', () => {
    const expected = [
      'reply',
      'card',
      'resolve',
      'reassign',
      'hold',
      'mention',
      'draft',
      'topic',
      'remind',
      'follow-up',
    ]
    for (const name of expected) {
      expect(conversationCommands[name]).toBeDefined()
      expect(typeof conversationCommands[name]).toBe('function')
    }
    expect(Object.keys(conversationCommands)).toHaveLength(10)
  })
})

describe('command input validation (no DB)', () => {
  const fakeCtx = {
    db: {} as never,
    deps: {} as never,
    conversationId: 'conv-1',
    contactId: 'contact-1',
    agentId: 'agent-1',
  }

  test('reply fails with empty message', async () => {
    const result = await conversationCommands.reply([], {}, fakeCtx)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Usage')
  })

  test('card fails with empty body', async () => {
    const result = await conversationCommands.card([], {}, fakeCtx)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Usage')
  })

  test('reassign fails with no target', async () => {
    const result = await conversationCommands.reassign([], {}, fakeCtx)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Usage')
  })

  test('reassign fails with invalid target spec', async () => {
    const result = await conversationCommands.reassign(['badspec'], {}, fakeCtx)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Invalid target spec')
  })

  test('mention fails with insufficient args', async () => {
    const result = await conversationCommands.mention([], {}, fakeCtx)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Usage')
  })

  test('mention fails with only target, no note', async () => {
    const result = await conversationCommands.mention(['role:ops'], {}, fakeCtx)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Usage')
  })

  test('draft fails with empty content', async () => {
    const result = await conversationCommands.draft([], {}, fakeCtx)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Usage')
  })

  test('topic fails with empty summary', async () => {
    const result = await conversationCommands.topic([], {}, fakeCtx)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Usage')
  })

  test('remind fails with missing args', async () => {
    const result = await conversationCommands.remind([], {}, fakeCtx)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Usage')
  })

  test('remind fails without --channel flag', async () => {
    const result = await conversationCommands.remind(['contact-1', 'Hello'], {}, fakeCtx)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--channel')
  })

  test('follow-up fails with no delay', async () => {
    const result = await conversationCommands['follow-up']([], {}, fakeCtx)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Usage')
  })

  test('follow-up fails with invalid delay', async () => {
    const result = await conversationCommands['follow-up'](['abc'], {}, fakeCtx)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('integer between')
  })

  test('follow-up fails with delay too small', async () => {
    const result = await conversationCommands['follow-up'](['10'], {}, fakeCtx)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('integer between')
  })
})
