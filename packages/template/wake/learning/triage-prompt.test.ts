/**
 * Unit tests for `learn.triage` prompt builder + parser.
 * No real LLM calls — stub path or explicit `parseTriageOutput` / `buildTriagePrompt` invocations.
 */

import { describe, expect, it } from 'bun:test'

import {
  buildTriagePrompt,
  type LearningSignalContext,
  parseTriageOutput,
  stubTriageOutput,
  type TriageInput,
} from './triage-prompt'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInput(
  overrides: Omit<Partial<TriageInput>, 'signal'> & { signal?: Partial<LearningSignalContext> } = {},
): TriageInput {
  const { signal, ...rest } = overrides
  return {
    organizationId: 'org1',
    agentId: 'agt1',
    agentName: 'MeriGPT',
    signal: {
      kind: 'staff_takeover' as LearningSignalContext['kind'],
      body: 'Try restarting your router first, that is the usual fix',
      ...signal,
    } as LearningSignalContext,
    ...rest,
  }
}

const THREE_SCOPES = [
  { scope: 'agents.agent_memory', promptHint: 'Agent working memory — general lessons and preferences' },
  { scope: 'contacts.contact', promptHint: 'Contact record — customer-specific facts' },
  { scope: 'team.staff_note', promptHint: 'Staff note — per-staff interaction preferences' },
]

// ─── Stub mode ────────────────────────────────────────────────────────────────

describe('stubTriageOutput', () => {
  it('short signal after stripping @agentName → worth_attention: false, low confidence', () => {
    const input = makeInput({ signal: { body: '@MeriGPT hi' } })
    const out = stubTriageOutput(input)
    expect(out.worth_attention).toBe(false)
    expect(out.confidence).toBeLessThan(0.2)
    expect(out.scope_hint).toBeNull()
  })

  it('substantive signal → worth_attention: true, scope_hint agents.agent_memory, confidence 0.5', () => {
    const input = makeInput({
      signal: { body: 'Try restarting your router first, that is the usual fix' },
    })
    const out = stubTriageOutput(input)
    expect(out.worth_attention).toBe(true)
    expect(out.scope_hint).toBe('agents.agent_memory')
    expect(out.confidence).toBe(0.5)
  })

  it('strips @agentName case-insensitively before length check', () => {
    // "@merigpt ok" → stripped "ok" → length 2 < 20 → false
    const input = makeInput({ signal: { body: '@merigpt ok' } })
    const out = stubTriageOutput(input)
    expect(out.worth_attention).toBe(false)
  })

  it('truncates summary to 200 chars and context to 800 chars for long body', () => {
    const longBody = 'x'.repeat(1000)
    const input = makeInput({ signal: { body: longBody } })
    const out = stubTriageOutput(input)
    expect(out.summary.length).toBe(200)
    expect(out.context.length).toBe(800)
  })
})

// ─── parseTriageOutput ────────────────────────────────────────────────────────

describe('parseTriageOutput', () => {
  it('parses valid JSON correctly', () => {
    const raw = JSON.stringify({
      worth_attention: true,
      scope_hint: 'agents.agent_memory',
      summary: 'Agent missed the router tip',
      context: 'Staff corrected the agent by providing the standard router restart fix',
      confidence: 0.8,
    })
    const out = parseTriageOutput(raw)
    expect(out.worth_attention).toBe(true)
    expect(out.scope_hint).toBe('agents.agent_memory')
    expect(out.confidence).toBe(0.8)
    expect(out.summary).toBe('Agent missed the router tip')
  })

  it('returns fallback stub when required field is missing', () => {
    const raw = JSON.stringify({ scope_hint: null, summary: 'x', context: 'y', confidence: 0.5 })
    const out = parseTriageOutput(raw)
    expect(out.worth_attention).toBe(false)
    expect(out.confidence).toBe(0)
    expect(out.summary).toBe('')
  })

  it('returns fallback stub for non-JSON input', () => {
    const out = parseTriageOutput('not json at all')
    expect(out.worth_attention).toBe(false)
    expect(out.confidence).toBe(0)
  })

  it('strips code fences before parsing', () => {
    const inner = JSON.stringify({
      worth_attention: false,
      scope_hint: null,
      summary: 'trivial',
      context: 'nothing to learn',
      confidence: 0.1,
    })
    const out = parseTriageOutput(`\`\`\`json\n${inner}\n\`\`\``)
    expect(out.worth_attention).toBe(false)
    expect(out.summary).toBe('trivial')
  })

  it('clamps confidence > 1 to 1.0', () => {
    const raw = JSON.stringify({
      worth_attention: true,
      scope_hint: null,
      summary: 's',
      context: 'c',
      confidence: 1.5,
    })
    const out = parseTriageOutput(raw)
    expect(out.confidence).toBe(1)
  })

  it('clamps negative confidence to 0', () => {
    const raw = JSON.stringify({
      worth_attention: false,
      scope_hint: null,
      summary: 's',
      context: 'c',
      confidence: -0.3,
    })
    const out = parseTriageOutput(raw)
    expect(out.confidence).toBe(0)
  })
})

// ─── buildTriagePrompt ────────────────────────────────────────────────────────

describe('buildTriagePrompt', () => {
  it('includes all three registered scope bullets in the user prompt (via system)', () => {
    const { system } = buildTriagePrompt(makeInput(), THREE_SCOPES)
    expect(system).toContain('- agents.agent_memory:')
    expect(system).toContain('- contacts.contact:')
    expect(system).toContain('- team.staff_note:')
  })

  it('system prompt instructs JSON-only response', () => {
    const { system } = buildTriagePrompt(makeInput(), THREE_SCOPES)
    expect(system.toLowerCase()).toContain('json only')
  })

  it('user prompt contains signal body', () => {
    const input = makeInput({ signal: { body: 'Router restart fixes most issues' } })
    const { user } = buildTriagePrompt(input, THREE_SCOPES)
    expect(user).toContain('Router restart fixes most issues')
  })

  it('user prompt is valid JSON', () => {
    const { user } = buildTriagePrompt(makeInput(), THREE_SCOPES)
    expect(() => JSON.parse(user)).not.toThrow()
  })
})

// ─── Truncation via stubTriageOutput (long body) ──────────────────────────────

describe('truncation', () => {
  it('stub output with 1000-char body → summary exactly 200 chars, context exactly 800 chars', () => {
    const longBody = 'a'.repeat(1000)
    const input = makeInput({ signal: { body: longBody } })
    const out = stubTriageOutput(input)
    expect(out.summary.length).toBe(200)
    expect(out.context.length).toBe(800)
  })
})
