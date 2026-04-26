/**
 * Sub-agent runtime — parent ↔ child wake coordination.
 *
 * The parent wake registers a child with `registerSubagent(parentWakeId,
 * childWakeId)`. The child runs an ordinary harness loop in a separate wake;
 * its events are journaled under a `subagent:<childWakeId>` namespace so
 * downstream consumers can filter by parent without ambiguity. Parent abort
 * cascades to children via `cascadeAbort(parentWakeId, reason)`.
 *
 * This module is the runtime contract; the actual `pi-agent-core` spawn lives
 * in the template's `subagentTool` wrapper. Core owns:
 *   - the registry (in-memory; rebuilt at boot from the journal if needed)
 *   - the journal-merge helper
 *   - the abort cascade primitive
 *   - the depth-limit guard (default 1)
 */

import type { JournalEventLike } from './journal'
import { append } from './journal'
import type { AbortContext } from './types'

/** Default max nesting depth for sub-agent spawns (parent → child only). */
export const DEFAULT_MAX_SUBAGENT_DEPTH = 1

export class SubagentDepthExceededError extends Error {
  readonly depth: number
  readonly maxDepth: number
  constructor(depth: number, maxDepth: number) {
    super(`subagent: max depth ${maxDepth} exceeded (current depth ${depth})`)
    this.depth = depth
    this.maxDepth = maxDepth
  }
}

interface RegistryEntry {
  childWakeId: string
  goal: string
  abort: AbortContext
  startedAt: Date
}

interface ParentEntry {
  /** Depth from the original wake (0 for first-level sub-agents). */
  depth: number
  children: Map<string, RegistryEntry>
}

const REGISTRY = new Map<string, ParentEntry>()

export interface RegisterSubagentInput {
  parentWakeId: string
  childWakeId: string
  goal: string
  /** Abort controller scoped to the child wake; cascade signals through this. */
  abort: AbortContext
  /** Override the parent's depth (advanced — used when re-hydrating from journal). */
  parentDepth?: number
  maxDepth?: number
  now?: () => Date
}

/**
 * Register a child wake under a parent. Returns the child entry. Throws
 * `SubagentDepthExceededError` when the parent itself is already a child at
 * `maxDepth`.
 */
export function registerSubagent(input: RegisterSubagentInput): RegistryEntry {
  const max = input.maxDepth ?? DEFAULT_MAX_SUBAGENT_DEPTH
  const parentDepth = input.parentDepth ?? REGISTRY.get(input.parentWakeId)?.depth ?? 0
  const childDepth = parentDepth + 1
  if (childDepth > max) throw new SubagentDepthExceededError(childDepth, max)

  let entry = REGISTRY.get(input.parentWakeId)
  if (!entry) {
    entry = { depth: parentDepth, children: new Map() }
    REGISTRY.set(input.parentWakeId, entry)
  }
  const child: RegistryEntry = {
    childWakeId: input.childWakeId,
    goal: input.goal,
    abort: input.abort,
    startedAt: (input.now ?? (() => new Date()))(),
  }
  entry.children.set(input.childWakeId, child)
  // Pre-allocate the child as its own ParentEntry so depth is grep-able.
  if (!REGISTRY.has(input.childWakeId)) REGISTRY.set(input.childWakeId, { depth: childDepth, children: new Map() })
  return child
}

export function unregisterSubagent(parentWakeId: string, childWakeId: string): void {
  REGISTRY.get(parentWakeId)?.children.delete(childWakeId)
  REGISTRY.delete(childWakeId)
}

export function getSubagentChildren(parentWakeId: string): RegistryEntry[] {
  const entry = REGISTRY.get(parentWakeId)
  if (!entry) return []
  return Array.from(entry.children.values())
}

export function getSubagentDepth(wakeId: string): number {
  return REGISTRY.get(wakeId)?.depth ?? 0
}

/**
 * Abort every child wake registered under the given parent, propagating
 * `reason` through each child's `AbortController`. Idempotent.
 */
export function cascadeAbort(parentWakeId: string, reason: string): { aborted: number } {
  const entry = REGISTRY.get(parentWakeId)
  if (!entry) return { aborted: 0 }
  let aborted = 0
  for (const child of entry.children.values()) {
    if (!child.abort.wakeAbort.signal.aborted) {
      child.abort.reason = reason
      child.abort.wakeAbort.abort(reason)
      aborted += 1
    }
  }
  return { aborted }
}

/** Build the namespaced event prefix for a sub-agent child wake. */
export function subagentJournalNamespace(childWakeId: string): string {
  return `subagent:${childWakeId}`
}

export interface AppendChildEventInput {
  organizationId: string
  conversationId: string
  parentWakeId: string
  childWakeId: string
  turnIndex: number
  event: JournalEventLike & Record<string, unknown>
}

/**
 * Journal a child event under the parent's wake id, tagging the event's
 * `payload._subagent` field with `subagent:<childWakeId>` so consumers can
 * filter for child-emitted events without losing the parent ↔ child link.
 *
 * The actual journal row is keyed to the parent wake; the namespace tag
 * lives in the payload and survives the row schema. This keeps the event
 * stream queryable by parent wake without duplicating rows.
 */
export async function appendChildEvent(input: AppendChildEventInput): Promise<void> {
  const namespace = subagentJournalNamespace(input.childWakeId)
  const payload = (input.event.payload as Record<string, unknown> | undefined) ?? {}
  const taggedEvent: JournalEventLike & Record<string, unknown> = {
    ...input.event,
    payload: { ...payload, _subagent: namespace, parentWakeId: input.parentWakeId },
  }
  await append({
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    wakeId: input.parentWakeId,
    turnIndex: input.turnIndex,
    event: taggedEvent,
  })
}

/** Flush the in-memory registry — tests + boot-time rehydration only. */
export function __resetSubagentRegistryForTests(): void {
  REGISTRY.clear()
}
