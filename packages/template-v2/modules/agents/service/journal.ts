/**
 * REAL Phase 1 — sole write path for agents.conversation_events (one-write-path discipline).
 * Every harness event, every observer-emitted event flows through `append()`.
 * Called inside the caller's transaction so domain mutation + journal land atomically.
 *
 * Factory-DI service. `createJournalService({ db })` returns the bound API;
 * `installJournalService(svc)` wires the module-scoped handle used by the free-function
 * wrappers. `setDb(db)` remains as a compatibility shim — constructs + installs in one
 * call — so existing tests don't need to migrate their import shape.
 */
import type { AgentEvent } from '@server/contracts/event'
import type { Tx } from '@server/contracts/inbox-port'

export interface JournalAppendInput {
  conversationId: string
  organizationId: string
  wakeId?: string | null
  turnIndex: number
  event: AgentEvent
}

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

export interface JournalService {
  append(input: JournalAppendInput, tx?: Tx): Promise<void>
  getLastWakeTail(conversationId: string): Promise<{ interrupted: boolean }>
  getLatestTurnIndex(conversationId: string, tx?: Tx): Promise<number>
}

export interface JournalServiceDeps {
  db: unknown
}

export function createJournalService(deps: JournalServiceDeps): JournalService {
  const db = deps.db as DbHandle

  async function append(input: JournalAppendInput, tx?: Tx): Promise<void> {
    const { conversationEvents } = await import('@modules/agents/schema')
    const runner = (tx as DbHandle | undefined) ?? db

    const ev = input.event as unknown as Record<string, unknown>

    await runner.insert(conversationEvents).values({
      conversationId: input.conversationId,
      organizationId: input.organizationId,
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

  async function getLastWakeTail(conversationId: string): Promise<{ interrupted: boolean }> {
    const { conversationEvents } = await import('@modules/agents/schema')
    const { desc, eq } = await import('drizzle-orm')
    const rows = await db
      .select({ type: conversationEvents.type, wakeId: conversationEvents.wakeId })
      .from(conversationEvents)
      .where(eq(conversationEvents.conversationId, conversationId))
      .orderBy(desc(conversationEvents.ts))
      .limit(100)

    if (rows.length === 0) return { interrupted: false }

    const latestWakeId = rows[0]?.wakeId
    if (!latestWakeId) return { interrupted: false }

    const wakeTypes = rows
      .filter((r) => r.wakeId === latestWakeId)
      .map((r) => r.type)
      .reverse()

    let lastToolEndIdx = -1
    for (let i = 0; i < wakeTypes.length; i++) {
      if (wakeTypes[i] === 'tool_execution_end') lastToolEndIdx = i
    }
    if (lastToolEndIdx === -1) return { interrupted: false }

    const TERMINAL = new Set(['message_end', 'agent_end', 'agent_aborted'])
    const hasTerminalAfter = wakeTypes.slice(lastToolEndIdx + 1).some((t) => TERMINAL.has(t))
    return { interrupted: !hasTerminalAfter }
  }

  async function getLatestTurnIndex(conversationId: string, tx?: Tx): Promise<number> {
    const { conversationEvents } = await import('@modules/agents/schema')
    const { desc, eq } = await import('drizzle-orm')
    const handle = (tx as { select: DbHandle['select'] } | undefined) ?? db
    const chain = handle.select({ turnIndex: conversationEvents.turnIndex }) as unknown as TurnIndexChain
    const rows = await chain
      .from(conversationEvents)
      .where(eq(conversationEvents.conversationId, conversationId))
      .orderBy(desc(conversationEvents.ts))
      .limit(1)
    return rows[0]?.turnIndex ?? 0
  }

  return { append, getLastWakeTail, getLatestTurnIndex }
}

let _currentJournalService: JournalService | null = null

export function installJournalService(svc: JournalService): void {
  _currentJournalService = svc
}

export function __resetJournalServiceForTests(): void {
  _currentJournalService = null
}

function current(): JournalService {
  if (!_currentJournalService) {
    throw new Error('agents/journal: service not installed — call installJournalService() in module init')
  }
  return _currentJournalService
}

/**
 * Compatibility shim: constructs and installs a journal service in one call.
 * Kept so legacy test imports (`import { setDb } from '@modules/agents/service/journal'`)
 * continue to work without touching every test file.
 */
export function setDb(db: unknown): void {
  installJournalService(createJournalService({ db }))
}

export async function append(input: JournalAppendInput, tx?: Tx): Promise<void> {
  return current().append(input, tx)
}

export async function getLastWakeTail(conversationId: string): Promise<{ interrupted: boolean }> {
  return current().getLastWakeTail(conversationId)
}

export async function getLatestTurnIndex(conversationId: string, tx?: Tx): Promise<number> {
  return current().getLatestTurnIndex(conversationId, tx)
}
