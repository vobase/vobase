/**
 * REAL Phase 1 — sole write path for agents.conversation_events (spec §2.3, plan B5).
 * Every harness event, every observer-emitted event flows through `append()`.
 * Called inside the caller's transaction so domain mutation + journal land atomically.
 */
import type { AgentEvent } from '@server/contracts/event'
import type { Tx } from '@server/contracts/inbox-port'

export interface JournalAppendInput {
  conversationId: string
  tenantId: string
  wakeId?: string | null
  turnIndex: number
  event: AgentEvent
}

// Minimal structural shapes the service uses on the drizzle handle. Kept narrow
// so a drizzle major-version shape change surfaces as a tsc error here, not a
// silent runtime cast.
type InsertChain = { values: (vals: unknown) => Promise<unknown> }
type SelectChain = {
  from: (table: unknown) => {
    where: (cond: unknown) => {
      orderBy: (...cols: unknown[]) => {
        limit: (n: number) => Promise<Array<{ type: string; wakeId: string | null }>>
      }
    }
  }
}
type TurnIndexChain = {
  from: (table: unknown) => {
    where: (cond: unknown) => {
      orderBy: (col: unknown) => { limit: (n: number) => Promise<Array<{ turnIndex: number }>> }
    }
  }
}
type DbHandle = {
  insert: (table: unknown) => InsertChain
  select: (fields?: unknown) => SelectChain
}

let _db: DbHandle | null = null

export function setDb(db: unknown): void {
  _db = db as DbHandle
}

function requireDb(): DbHandle {
  if (!_db) throw new Error('agents/journal: db not initialised — call setDb() in module init')
  return _db
}

/**
 * Appends one AgentEvent row to agents.conversation_events.
 * If `tx` is provided the insert runs inside that transaction (atomic with the
 * domain mutation that triggered the event). Otherwise uses the module db handle.
 */
export async function append(input: JournalAppendInput, tx?: Tx): Promise<void> {
  const { conversationEvents } = await import('@modules/agents/schema')
  const runner = (tx as DbHandle | undefined) ?? requireDb()

  const ev = input.event as unknown as Record<string, unknown>

  await runner.insert(conversationEvents).values({
    conversationId: input.conversationId,
    tenantId: input.tenantId,
    wakeId: input.wakeId ?? null,
    turnIndex: input.turnIndex,
    type: ev.type as string,
    role: (ev.role as string | undefined) ?? null,
    content: (ev.content as string | undefined) ?? null,
    toolCallId: (ev.toolCallId as string | undefined) ?? null,
    toolCalls: (ev.toolCalls as unknown) ?? null,
    toolName: (ev.toolName as string | undefined) ?? null,
    reasoning: (ev.reasoning as string | undefined) ?? null,
    reasoningDetails: (ev.reasoningDetails as unknown) ?? null,
    tokenCount: (ev.tokenCount as number | undefined) ?? null,
    finishReason: (ev.finishReason as string | undefined) ?? null,
    llmTask: (ev.task as string | undefined) ?? null,
    tokensIn: (ev.tokensIn as number | undefined) ?? null,
    tokensOut: (ev.tokensOut as number | undefined) ?? null,
    cacheReadTokens: (ev.cacheReadTokens as number | undefined) ?? null,
    costUsd: (ev.costUsd as string | undefined) ?? null,
    latencyMs: (ev.latencyMs as number | undefined) ?? null,
    model: (ev.model as string | undefined) ?? null,
    provider: (ev.provider as string | undefined) ?? null,
    payload: (ev.payload as unknown) ?? null,
  })
}

/**
 * Inspect the tail of the most recent (previous) wake for a conversation.
 *
 * Returns `{ interrupted: true }` when the last wake appears to have crashed
 * mid-turn: there is at least one `tool_execution_end` with no subsequent
 * `message_end` or `agent_end`.
 *
 * Returns `{ interrupted: false }` when:
 *   - The conversation has no prior events (fresh start).
 *   - The last wake ended normally (message_end / agent_end / agent_aborted
 *     found after the final tool_execution_end).
 */
export async function getLastWakeTail(conversationId: string): Promise<{ interrupted: boolean }> {
  const { conversationEvents } = await import('@modules/agents/schema')
  const { desc, eq } = await import('drizzle-orm')
  const rows = await requireDb()
    .select({ type: conversationEvents.type, wakeId: conversationEvents.wakeId })
    .from(conversationEvents)
    .where(eq(conversationEvents.conversationId, conversationId))
    .orderBy(desc(conversationEvents.ts))
    .limit(100)

  if (rows.length === 0) return { interrupted: false }

  const latestWakeId = rows[0]?.wakeId
  if (!latestWakeId) return { interrupted: false }

  // Wake events in chronological order (query returns DESC).
  const wakeTypes = rows
    .filter((r) => r.wakeId === latestWakeId)
    .map((r) => r.type)
    .reverse()

  // Find the last `tool_execution_end` position.
  let lastToolEndIdx = -1
  for (let i = 0; i < wakeTypes.length; i++) {
    if (wakeTypes[i] === 'tool_execution_end') lastToolEndIdx = i
  }
  if (lastToolEndIdx === -1) return { interrupted: false }

  // If any terminal event follows, the wake completed normally.
  const TERMINAL = new Set(['message_end', 'agent_end', 'agent_aborted'])
  const hasTerminalAfter = wakeTypes.slice(lastToolEndIdx + 1).some((t) => TERMINAL.has(t))
  return { interrupted: !hasTerminalAfter }
}

/**
 * Latest `turnIndex` observed for a conversation. Callers outside the agents
 * module use this to stamp the right turn on out-of-band journal events (e.g.
 * a card-reply inbound that didn't arrive via a real wake).
 */
export async function getLatestTurnIndex(conversationId: string, tx?: Tx): Promise<number> {
  const { conversationEvents } = await import('@modules/agents/schema')
  const { desc, eq } = await import('drizzle-orm')
  const handle = (tx as { select: DbHandle['select'] } | undefined) ?? requireDb()
  const chain = handle.select({ turnIndex: conversationEvents.turnIndex }) as unknown as TurnIndexChain
  const rows = await chain
    .from(conversationEvents)
    .where(eq(conversationEvents.conversationId, conversationId))
    .orderBy(desc(conversationEvents.ts))
    .limit(1)
  return rows[0]?.turnIndex ?? 0
}
