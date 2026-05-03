/**
 * Unit tests for the `request_caption` agent tool.
 *
 * The full integration acceptance test (`drive-request-caption.test.ts`) lives
 * in tests/e2e/ in Commit 2 — it boots a real wake, runs the tool, and asserts
 * the `INBOUND_TO_WAKE_JOB` enqueue with `{ trigger: 'caption_ready', ... }`.
 *
 * This file pins the surface contract: the tool's `defineAgentTool` shape
 * (audience, lane, name) so frontend / wake builders can rely on it.
 */

import { describe, expect, it } from 'bun:test'

import { requestCaptionTool } from './request-caption'

describe('requestCaptionTool', () => {
  it('declares lane=conversation, audience=internal, name=request_caption', () => {
    expect(requestCaptionTool.name).toBe('request_caption')
    expect(requestCaptionTool.lane).toBe('conversation')
    expect(requestCaptionTool.audience).toBe('internal')
  })

  it('carries an AGENTS.md prompt (frozen-snapshot guidance)', () => {
    expect(requestCaptionTool.prompt).toBeTruthy()
    expect(requestCaptionTool.prompt ?? '').toContain('Fire-and-forget')
    expect(requestCaptionTool.prompt ?? '').toContain('next wake')
  })

  // FIXTURE-NEEDED: full e2e wake-boot test lives in tests/e2e/drive-request-caption.test.ts
  // (Commit 2). It would: upload an .mp4, agent calls the tool, the job runs
  // (stubbed multimodal), driveFile flips to `extracted`, INBOUND_TO_WAKE_JOB
  // enqueued with { trigger: 'caption_ready', conversationId, fileId }, wake
  // handler boots, wake/trigger.ts:REGISTRY['caption_ready'].render(...) is
  // exercised. Skipped here as a `.todo` so this commit remains test-green
  // without requiring the WakeTrigger union extension (Commit 2 / Step 11a).
  it.todo('end-to-end wake boot fires caption_ready trigger render (Commit 2)', () => {})
})
