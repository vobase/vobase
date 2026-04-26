/**
 * Dispatch-loop primitives: idempotency-key minting, per-tool concurrency
 * caps, and orphan detection for restart recovery.
 *
 * The wake loop drives these via `journalDispatchStart` /
 * `journalDispatchComplete` around every `execute()`. Restart-recovery walks
 * the latest wake's tail, pairs starts with completes by `idempotencyKey`,
 * and surfaces orphans so the wake-handler can either replay (idempotent
 * tool) or abort (non-idempotent).
 */

import type { JournalEventLike } from './journal'
import { append } from './journal'
import type { AgentTool, ToolDispatchCompletedEvent, ToolDispatchLostEvent, ToolDispatchStartedEvent } from './types'

/**
 * Stable per-call idempotency key. Tool-call IDs are unique within a wake
 * but not across restarts; pairing the wakeId with the toolCallId gives a
 * key that survives crashes and matches across `started`/`completed` events.
 */
export function mintIdempotencyKey(wakeId: string, toolCallId: string): string {
  return `${wakeId}:${toolCallId}`
}

export interface JournalDispatchInput {
  organizationId: string
  conversationId: string
  wakeId: string
  turnIndex: number
  toolCallId: string
  toolName: string
  now?: () => Date
}

export async function journalDispatchStart(input: JournalDispatchInput): Promise<string> {
  const idempotencyKey = mintIdempotencyKey(input.wakeId, input.toolCallId)
  const event: ToolDispatchStartedEvent = {
    type: 'tool_dispatch_started',
    ts: (input.now ?? (() => new Date()))(),
    wakeId: input.wakeId,
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    turnIndex: input.turnIndex,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    idempotencyKey,
  }
  await append({
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    wakeId: input.wakeId,
    turnIndex: input.turnIndex,
    event,
  })
  return idempotencyKey
}

export interface JournalDispatchCompleteInput extends JournalDispatchInput {
  idempotencyKey: string
  ok: boolean
  durationMs: number
}

export async function journalDispatchComplete(input: JournalDispatchCompleteInput): Promise<void> {
  const event: ToolDispatchCompletedEvent = {
    type: 'tool_dispatch_completed',
    ts: (input.now ?? (() => new Date()))(),
    wakeId: input.wakeId,
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    turnIndex: input.turnIndex,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    idempotencyKey: input.idempotencyKey,
    ok: input.ok,
    durationMs: input.durationMs,
  }
  await append({
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    wakeId: input.wakeId,
    turnIndex: input.turnIndex,
    event,
  })
}

// ─── Restart-recovery orphan detection ───────────────────────────────────────

export interface DispatchOrphan {
  toolCallId: string
  toolName: string
  idempotencyKey: string
  turnIndex: number
}

interface OrphanScanInput {
  events: ReadonlyArray<JournalEventLike & Record<string, unknown>>
}

/**
 * Pair `tool_dispatch_started` with `tool_dispatch_completed` by
 * `idempotencyKey`; any started event without a matching completion is an
 * orphan. The events list is whatever `journal.getLastWakeTail()` returns
 * (or any superset of the wake's events) — `type` narrows each event into
 * the discriminated `ToolDispatch{Started,Completed}Event` shape so no `as`
 * casts are needed.
 */
export function scanDispatchOrphans(input: OrphanScanInput): DispatchOrphan[] {
  const completed = new Set<string>()
  const started = new Map<string, DispatchOrphan>()
  for (const ev of input.events) {
    if (isDispatchCompletedEvent(ev)) {
      completed.add(ev.idempotencyKey)
      continue
    }
    if (isDispatchStartedEvent(ev)) {
      started.set(ev.idempotencyKey, {
        toolCallId: ev.toolCallId,
        toolName: ev.toolName,
        idempotencyKey: ev.idempotencyKey,
        turnIndex: ev.turnIndex,
      })
    }
  }
  const orphans: DispatchOrphan[] = []
  for (const [key, dispatch] of started) {
    if (!completed.has(key)) orphans.push(dispatch)
  }
  return orphans
}

function isDispatchStartedEvent(
  ev: JournalEventLike & Record<string, unknown>,
): ev is JournalEventLike & ToolDispatchStartedEvent {
  if (ev.type !== 'tool_dispatch_started') return false
  return (
    typeof ev.idempotencyKey === 'string' &&
    typeof ev.toolCallId === 'string' &&
    typeof ev.toolName === 'string' &&
    typeof ev.turnIndex === 'number'
  )
}

function isDispatchCompletedEvent(
  ev: JournalEventLike & Record<string, unknown>,
): ev is JournalEventLike & ToolDispatchCompletedEvent {
  return ev.type === 'tool_dispatch_completed' && typeof ev.idempotencyKey === 'string'
}

export interface ResolveOrphansInput {
  organizationId: string
  conversationId: string
  wakeId: string
  orphans: ReadonlyArray<DispatchOrphan>
  /** Tool registry — used to look up the `idempotent` flag. */
  tools: ReadonlyArray<Pick<AgentTool, 'name' | 'idempotent'>>
  now?: () => Date
}

export interface ResolveOrphansResult {
  /** Orphans that may be safely replayed because `tool.idempotent === true`. */
  replayable: DispatchOrphan[]
  /** Orphans that must abort the wake — `tool_dispatch_lost` was journalled. */
  lost: DispatchOrphan[]
}

/**
 * Decide what to do with each orphan: idempotent → replayable, otherwise →
 * journal `tool_dispatch_lost` and surface as `lost`. The actual replay
 * (calling `execute()` again with the saved input) is the wake-handler's
 * responsibility — this function only journalises lost dispatches.
 */
export async function resolveDispatchOrphans(input: ResolveOrphansInput): Promise<ResolveOrphansResult> {
  const byName = new Map(input.tools.map((t) => [t.name, t]))
  const replayable: DispatchOrphan[] = []
  const lost: DispatchOrphan[] = []

  for (const orphan of input.orphans) {
    const def = byName.get(orphan.toolName)
    if (def?.idempotent) {
      replayable.push(orphan)
      continue
    }

    const event: ToolDispatchLostEvent = {
      type: 'tool_dispatch_lost',
      ts: (input.now ?? (() => new Date()))(),
      wakeId: input.wakeId,
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      turnIndex: orphan.turnIndex,
      toolCallId: orphan.toolCallId,
      toolName: orphan.toolName,
      idempotencyKey: orphan.idempotencyKey,
    }
    await append({
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      wakeId: input.wakeId,
      turnIndex: orphan.turnIndex,
      event,
    })
    lost.push(orphan)
  }

  return { replayable, lost }
}

// ─── Per-tool concurrency caps ───────────────────────────────────────────────

/**
 * Tracks in-flight dispatch counts per tool name. The wake's dispatcher calls
 * `tryAcquire(name, maxConcurrent)`; if the slot is free the function
 * returns a release callback, otherwise `null` and the dispatcher must queue.
 */
export interface ConcurrencyGate {
  tryAcquire(toolName: string, maxConcurrent: number): null | (() => void)
  inFlight(toolName: string): number
}

export function createConcurrencyGate(): ConcurrencyGate {
  const counts = new Map<string, number>()
  return {
    tryAcquire(toolName, maxConcurrent) {
      const cap = maxConcurrent <= 0 ? 1 : maxConcurrent
      const cur = counts.get(toolName) ?? 0
      if (cur >= cap) return null
      counts.set(toolName, cur + 1)
      let released = false
      return () => {
        if (released) return
        released = true
        const next = (counts.get(toolName) ?? 0) - 1
        if (next <= 0) counts.delete(toolName)
        else counts.set(toolName, next)
      }
    },
    inFlight(toolName) {
      return counts.get(toolName) ?? 0
    },
  }
}
