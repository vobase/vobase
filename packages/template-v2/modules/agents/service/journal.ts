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

let _db: unknown = null

export function setDb(db: unknown): void {
  _db = db
}

function requireDb(): { insert: Function } {
  if (!_db) throw new Error('agents/journal: db not initialised — call setDb() in module init')
  return _db as { insert: Function }
}

/**
 * Appends one AgentEvent row to agents.conversation_events.
 * If `tx` is provided the insert runs inside that transaction (atomic with the
 * domain mutation that triggered the event). Otherwise uses the module db handle.
 */
export async function append(input: JournalAppendInput, tx?: Tx): Promise<void> {
  const { conversationEvents } = await import('@modules/agents/schema')
  const db = requireDb()
  const runner = (tx as { insert: Function } | undefined) ?? db

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
 * Latest `turnIndex` observed for a conversation. Callers outside the agents
 * module use this to stamp the right turn on out-of-band journal events (e.g.
 * a card-reply inbound that didn't arrive via a real wake).
 */
export async function getLatestTurnIndex(conversationId: string, tx?: Tx): Promise<number> {
  const { conversationEvents } = await import('@modules/agents/schema')
  const { desc, eq } = await import('drizzle-orm')
  type TurnIndexHandle = {
    select: (c?: unknown) => {
      from: (t: unknown) => {
        where: (c: unknown) => { orderBy: (col: unknown) => { limit: (n: number) => Promise<unknown[]> } }
      }
    }
  }
  const handle = (tx as TurnIndexHandle | undefined) ?? (requireDb() as unknown as TurnIndexHandle)
  const rows = await handle
    .select({ turnIndex: conversationEvents.turnIndex })
    .from(conversationEvents)
    .where(eq(conversationEvents.conversationId, conversationId))
    .orderBy(desc(conversationEvents.ts))
    .limit(1)
  const row = rows[0] as { turnIndex: number } | undefined
  return row?.turnIndex ?? 0
}
