/**
 * Typed wrapper around the journal write path for `harness.conversation_events`.
 *
 * Constrains `event` to the project's `AgentEvent` discriminated union so every
 * cross-module journal write is checked against a known event shape. Routes
 * through `@vobase/core`'s installed journal service so the bound DB handle is
 * shared with the rest of the messaging write path.
 *
 * Auto-extracts event-specific (non-reserved) fields into the `payload` jsonb
 * column. The reserved set mirrors the columns `journalAppend` (in core)
 * already maps explicitly — anything outside that set would otherwise be
 * dropped on write, so the wrapper bundles the rest into `payload` to keep
 * the persisted record lossless.
 *
 * This is the single allowed entry-point for non-messaging modules that need
 * to journal an event — the `check:shape` rule (see
 * `scripts/check-module-shape.ts`) bans direct `db.insert(conversationEvents)`
 * outside `modules/messaging/service/**`.
 */

import type { AgentEvent } from '@modules/agents/events'
import { journalAppend } from '@vobase/core'

export type Tx = unknown

export interface AppendJournalEventInput<E extends AgentEvent = AgentEvent> {
  conversationId: string
  organizationId: string
  wakeId?: string | null
  turnIndex: number
  event: E
}

const RESERVED_EVENT_FIELDS = new Set<string>([
  'type',
  'ts',
  'wakeId',
  'conversationId',
  'organizationId',
  'turnIndex',
  'role',
  'content',
  'toolCallId',
  'toolCalls',
  'toolName',
  'reasoning',
  'reasoningDetails',
  'tokenCount',
  'finishReason',
  'task',
  'tokensIn',
  'tokensOut',
  'cacheReadTokens',
  'costUsd',
  'latencyMs',
  'model',
  'provider',
  'payload',
])

export function appendJournalEvent<E extends AgentEvent>(input: AppendJournalEventInput<E>, tx?: Tx): Promise<void> {
  const ev = input.event as unknown as Record<string, unknown>
  const extra: Record<string, unknown> = {}
  let hasExtra = false
  for (const key of Object.keys(ev)) {
    if (!RESERVED_EVENT_FIELDS.has(key)) {
      extra[key] = ev[key]
      hasExtra = true
    }
  }

  const explicitPayload = ev.payload as Record<string, unknown> | undefined | null
  const payload = explicitPayload != null ? { ...explicitPayload, ...extra } : hasExtra ? extra : null

  return journalAppend(
    {
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      wakeId: input.wakeId ?? null,
      turnIndex: input.turnIndex,
      event: { ...ev, payload } as unknown as E,
    },
    tx,
  )
}
