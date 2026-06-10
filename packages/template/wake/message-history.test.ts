import { describe, expect, it } from 'bun:test'
import type { AgentMessage } from '@mariozechner/pi-agent-core'

import { pruneOrphanToolResults, stripImageContent } from './message-history'

function userMsg(text: string): AgentMessage {
  return { role: 'user', content: text, timestamp: 0 } as AgentMessage
}

function assistantWithToolCalls(callIds: string[]): AgentMessage {
  return {
    role: 'assistant',
    content: callIds.map((id) => ({ type: 'toolCall', id, name: 'fake', arguments: {} })),
    api: 'openai-responses',
    provider: 'openai',
    model: 'gpt-test',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 },
    },
    stopReason: 'toolUse',
    timestamp: 0,
  } as unknown as AgentMessage
}

function assistantText(text: string): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-responses',
    provider: 'openai',
    model: 'gpt-test',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 },
    },
    stopReason: 'stop',
    timestamp: 0,
  } as unknown as AgentMessage
}

function toolResult(toolCallId: string, toolName = 'fake'): AgentMessage {
  return {
    role: 'toolResult',
    toolCallId,
    toolName,
    content: [{ type: 'text', text: '{"ok":true}' }],
    isError: false,
    timestamp: 0,
  } as AgentMessage
}

describe('pruneOrphanToolResults', () => {
  it('empty history — returns empty with 0 dropped', () => {
    const { cleaned, droppedCount } = pruneOrphanToolResults([])
    expect(cleaned).toEqual([])
    expect(droppedCount).toBe(0)
  })

  it('all valid pairs — preserves order, 0 dropped', () => {
    const history: AgentMessage[] = [
      userMsg('hi'),
      assistantWithToolCalls(['call_A', 'call_B']),
      toolResult('call_A'),
      toolResult('call_B'),
      assistantText('done'),
    ]
    const { cleaned, droppedCount } = pruneOrphanToolResults(history)
    expect(droppedCount).toBe(0)
    expect(cleaned).toEqual(history)
  })

  it('orphan toolResult with no preceding assistant — dropped', () => {
    const history: AgentMessage[] = [
      userMsg('hi'),
      assistantText('thinking…'),
      toolResult('call_orphan'), // no assistant ever called this
      assistantText('done'),
    ]
    const { cleaned, droppedCount } = pruneOrphanToolResults(history)
    expect(droppedCount).toBe(1)
    expect(cleaned).toEqual([history[0], history[1], history[3]])
  })

  it('reproduction of the prod incident — orphan send_card sandwiched between two empty-stop assistants', () => {
    // Mirrors conversation 1g1tq380: assistant batch with 3 parallel toolCalls,
    // 3 valid toolResults, then a "stop with empty text" assistant, then an
    // orphan toolResult for send_card whose assistant function_call was never
    // persisted, then another empty-stop assistant.
    const history: AgentMessage[] = [
      assistantWithToolCalls(['call_consult', 'call_remember', 'call_dismiss']),
      toolResult('call_consult', 'consult_staff'),
      toolResult('call_remember', 'remember'),
      toolResult('call_dismiss', 'dismiss_candidate'),
      assistantText(''), // seq 267 in the prod incident — stop, empty
      toolResult('call_epTGeBH328xQY2otJsAr513l', 'send_card'), // orphan
      assistantText(''), // seq 269 — stop, empty
    ]
    const { cleaned, droppedCount } = pruneOrphanToolResults(history)
    expect(droppedCount).toBe(1)
    expect(cleaned.find((m) => m.role === 'toolResult' && m.toolCallId.startsWith('call_epTGeBH'))).toBeUndefined()
    expect(cleaned).toHaveLength(history.length - 1)
  })

  it('toolCall id matches across non-adjacent messages — preserved', () => {
    const history: AgentMessage[] = [
      assistantWithToolCalls(['call_A']),
      assistantText('extra text turn'), // unusual but possible
      toolResult('call_A'),
    ]
    const { cleaned, droppedCount } = pruneOrphanToolResults(history)
    expect(droppedCount).toBe(0)
    expect(cleaned).toEqual(history)
  })

  it('toolResult appearing BEFORE its assistant — dropped (out-of-order means broken)', () => {
    const history: AgentMessage[] = [toolResult('call_A'), assistantWithToolCalls(['call_A'])]
    const { cleaned, droppedCount } = pruneOrphanToolResults(history)
    expect(droppedCount).toBe(1)
    expect(cleaned).toEqual([history[1]])
  })

  it('multiple orphans — all dropped', () => {
    const history: AgentMessage[] = [
      assistantWithToolCalls(['call_A']),
      toolResult('call_A'),
      toolResult('call_orphan1'),
      toolResult('call_orphan2'),
      assistantText('done'),
    ]
    const { cleaned, droppedCount } = pruneOrphanToolResults(history)
    expect(droppedCount).toBe(2)
    expect(cleaned).toEqual([history[0], history[1], history[4]])
  })

  it('non-message roles (user, assistant-text-only) — always preserved', () => {
    const history: AgentMessage[] = [userMsg('first'), assistantText('hi'), userMsg('second'), assistantText('bye')]
    const { cleaned, droppedCount } = pruneOrphanToolResults(history)
    expect(droppedCount).toBe(0)
    expect(cleaned).toEqual(history)
  })
})

function userMsgWithImages(text: string, imageCount: number): AgentMessage {
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      ...Array.from({ length: imageCount }, (_, i) => ({ type: 'image', data: `b64-${i}`, mimeType: 'image/jpeg' })),
    ],
    timestamp: 0,
  } as unknown as AgentMessage
}

describe('stripImageContent', () => {
  it('replaces image parts in a user turn with a text marker, preserving the text part', () => {
    const stripped = stripImageContent([userMsgWithImages('here is a reference photo:', 2)])
    const content = stripped[0].content as Array<{ type: string; text?: string }>
    expect(content.filter((p) => p.type === 'image')).toHaveLength(0)
    expect(content.filter((p) => p.type === 'text' && p.text === '[image]')).toHaveLength(2)
    expect(content.some((p) => p.type === 'text' && p.text === 'here is a reference photo:')).toBe(true)
  })

  it('leaves string-content user messages, assistant messages and image-free user turns unchanged', () => {
    const history: AgentMessage[] = [
      userMsg('plain string'),
      assistantText('hi'),
      { role: 'user', content: [{ type: 'text', text: 'only text part' }], timestamp: 0 } as unknown as AgentMessage,
    ]
    expect(stripImageContent(history)).toEqual(history)
  })

  it('does not mutate the input messages', () => {
    const input = userMsgWithImages('hi', 1)
    stripImageContent([input])
    expect((input.content as Array<{ type: string }>).filter((p) => p.type === 'image')).toHaveLength(1)
  })
})
