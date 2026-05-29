/**
 * Read-only debug surface over `harness.{conversation_events,messages,threads}`.
 * Backs the admin-tier `agents debug {wakes,timeline,llm-io}` CLI verbs, plus
 * `waitForWake` — a blocking poll-the-journal waiter (built on the same reads)
 * behind the `agents debug wake-sync` verb. Every query here is a SELECT; the
 * only side effect is sleeping between polls.
 */

import { conversationEvents } from '@vobase/core'
import { and, eq, sql } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'

// ─── Public types ────────────────────────────────────────────────────────────

export interface ListWakesInput {
  organizationId: string
  conversationId: string
  /** Default 20; cap 100 to keep the table response bounded. */
  limit?: number
  /** ISO timestamp; if set, only wakes started at-or-after this point are returned. */
  since?: Date
}

export interface WakeSummary {
  wakeId: string
  trigger: string | null
  /** Truncated JSON string of the full `triggerPayload`; null when payload is missing. */
  triggerPayloadPreview: string | null
  startedAt: Date
  endedAt: Date
  /** Number of distinct turns observed (max turn_index + 1). */
  turns: number
  /** Number of `tool_dispatch_started` events recorded for the wake. */
  toolCalls: number
  /** Sum of `cost_usd` across LLM calls in the wake. */
  costUsd: number
  /** Hex digest from `agent_start.payload.systemHash`; useful for spotting frozen-snapshot drift across wakes. */
  systemHash: string | null
  /** From `agent_end.payload.reason` (`complete`/`blocked`/`aborted`/`error`); null if the wake hasn't ended. */
  endReason: string | null
}

export interface ListTimelineInput {
  organizationId: string
  wakeId: string
  /** When false (default), `content` is truncated to ~200 chars per row. */
  full?: boolean
}

export interface TimelineEvent {
  id: string
  ts: Date
  type: string
  role: string | null
  turnIndex: number
  toolName: string | null
  /** Truncated unless `full=true`. */
  contentPreview: string | null
  toolCalls: unknown
  payload: unknown
  costUsd: number | null
  latencyMs: number | null
}

export interface WaitForWakeInput {
  organizationId: string
  conversationId: string
  /**
   * Watermark — only wakes whose `agent_start.ts >= since` are considered the
   * target. Callers capture this immediately *before* the triggering action
   * (inbound message, reassign) so a wake left over from an earlier turn isn't
   * mistaken for the one under test.
   */
  since: Date
  /** Total wall-clock budget in ms before giving up with `status: 'timeout'`. */
  timeoutMs: number
  /** Poll cadence in ms; defaults to 1500. */
  pollMs?: number
}

export interface WakeToolCall {
  toolName: string
  /** Truncated JSON of the dispatched arguments (`tool_calls` jsonb, falling back to `payload`). */
  argsPreview: string | null
}

export interface WaitForWakeResult {
  /**
   * `'settled'` — an `agent_end` was observed for the target wake.
   * `'timeout'` — the wake started but didn't end inside the budget.
   * `'no_wake'` — no `agent_start` appeared after the watermark (the trigger
   *   never produced a wake — e.g. the conversation isn't assigned to an agent,
   *   or the message was deduplicated).
   */
  status: 'settled' | 'timeout' | 'no_wake'
  wakeId: string | null
  trigger: string | null
  /** `agent_end.payload.reason` verbatim — `complete` / `blocked` (paused on approval) / `aborted` / `error`; null until ended. */
  endReason: string | null
  turns: number
  toolCalls: number
  costUsd: number
  startedAt: Date | null
  endedAt: Date | null
  /** Per-tool-call detail from `tool_execution_start` events, in execution order. Surfaces the `reply`/`add_note` arguments the customer/staff would see. */
  toolCallDetail: WakeToolCall[]
  /** Wall-clock the wait actually consumed (ms). */
  waitedMs: number
}

export interface ListLlmIoInput {
  organizationId: string
  /** Required unless `wakeId` is given (in which case the conversation is derived from the wake). */
  conversationId?: string
  /**
   * When set, narrows the seq window to messages whose `created_at` falls
   * inside that wake's `agent_start..agent_end` time range. Also auto-derives
   * `conversationId` from the wake's `agent_start` event.
   */
  wakeId?: string
  /** Optional inclusive lower bound on `seq`. */
  seqFrom?: number
  /** Optional inclusive upper bound on `seq`. */
  seqTo?: number
  /** Optional pi-agent-core role filter (`user` / `assistant` / `toolResult` / `system`). Applied client-side. */
  role?: string
  /** Optional tool-name filter (matches assistant tool-calls and toolResult rows). Applied client-side. */
  tool?: string
  /** Default 30; cap 200. Returns the LATEST N rows by seq (then re-sorted ascending). */
  limit?: number
  /** When false (default), `payload` is replaced by a compact preview. */
  full?: boolean
}

export interface LlmIoRow {
  seq: number
  /** From `payload.role` — `user` / `assistant` / `toolResult` / `system`. */
  role: string
  /** From `payload.model` (assistant rows only); null elsewhere. */
  model: string | null
  /** From `payload.usage.input` (assistant rows). null when absent. */
  tokensIn: number | null
  /** From `payload.usage.output`. */
  tokensOut: number | null
  /** From `payload.usage.cacheRead`. */
  cacheReadTokens: number | null
  /** From `payload.usage.cost.total`. */
  costUsd: number | null
  /**
   * Short synopsis of the row content, derived from payload shape:
   *   user        → first text fragment
   *   assistant   → tool-call summary `<toolName>(<args>)` or text
   *   toolResult  → `<toolName> → <result>`
   *   system      → first text fragment
   */
  preview: string
  /**
   * Tool name when the row references one (assistant tool-call or toolResult).
   * Extracted at projection time so `--tool=<name>` filtering works even when
   * `--full=false` (the default) has replaced `payload` with a stub.
   */
  toolName: string | null
  /**
   * The raw payload — included verbatim when `full=true`, replaced with
   * `{ truncated: true }` otherwise so JSON output stays bounded by default.
   */
  payload: unknown
  createdAt: Date
}

// ─── Service interface ───────────────────────────────────────────────────────

export interface DebugReadersService {
  listWakes(input: ListWakesInput): Promise<WakeSummary[]>
  listTimeline(input: ListTimelineInput): Promise<TimelineEvent[]>
  listLlmIo(input: ListLlmIoInput): Promise<LlmIoRow[]>
  /**
   * Block until the first wake started at-or-after `since` (for the given
   * conversation) reaches a terminal `agent_end`, polling every `pollMs`.
   * Backs the `agents debug wake-sync` test verb — collapses the
   * send-then-poll-then-cross-check loop into one awaited call. Returns the
   * wake summary + per-tool-call detail so callers see what the agent did
   * without a second round-trip.
   */
  waitForWake(input: WaitForWakeInput): Promise<WaitForWakeResult>
}

// ─── Factory ─────────────────────────────────────────────────────────────────

const TIMELINE_PREVIEW_BYTES = 200

function previewJsonb(value: unknown, maxBytes = 120): string | null {
  if (value === null || value === undefined) return null
  let s: string
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    return null
  }
  if (s.length <= maxBytes) return s
  return `${s.slice(0, maxBytes)}…`
}

export function createDebugReadersService(deps: { db: ScopedDb }): DebugReadersService {
  const { db } = deps

  async function listWakes(input: ListWakesInput): Promise<WakeSummary[]> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100)

    // Postgres has no MAX(jsonb), so cast `triggerPayload` to text inside the
    // conditional aggregate; the previewer stringifies anyway.
    const rows = (await db.execute(sql`
      SELECT
        wake_id AS "wakeId",
        MAX(CASE WHEN type = 'agent_start' THEN payload ->> 'trigger' END) AS "trigger",
        MAX(CASE WHEN type = 'agent_start' THEN (payload -> 'triggerPayload')::text END) AS "triggerPayload",
        MAX(CASE WHEN type = 'agent_start' THEN payload ->> 'systemHash' END) AS "systemHash",
        MIN(ts) AS "startedAt",
        MAX(ts) AS "endedAt",
        COALESCE(MAX(turn_index), 0) + 1 AS "turns",
        COUNT(*) FILTER (WHERE type = 'tool_dispatch_started') AS "toolCalls",
        COALESCE(SUM(cost_usd), 0) AS "costUsd",
        MAX(CASE WHEN type = 'agent_end' THEN payload ->> 'reason' END) AS "endReason"
      FROM harness.conversation_events
      WHERE conversation_id = ${input.conversationId}
        AND organization_id = ${input.organizationId}
        AND wake_id IS NOT NULL
        ${input.since ? sql`AND ts >= ${input.since.toISOString()}` : sql``}
      GROUP BY wake_id
      ORDER BY MIN(ts) DESC
      LIMIT ${limit}
    `)) as unknown as Array<{
      wakeId: string
      trigger: string | null
      triggerPayload: string | null
      systemHash: string | null
      startedAt: Date | string
      endedAt: Date | string
      turns: number | string
      toolCalls: number | string
      costUsd: number | string
      endReason: string | null
    }>

    return rows.map((r) => ({
      wakeId: r.wakeId,
      trigger: r.trigger,
      triggerPayloadPreview: previewJsonb(r.triggerPayload),
      startedAt: r.startedAt instanceof Date ? r.startedAt : new Date(r.startedAt),
      endedAt: r.endedAt instanceof Date ? r.endedAt : new Date(r.endedAt),
      turns: Number(r.turns),
      toolCalls: Number(r.toolCalls),
      costUsd: Number(r.costUsd),
      systemHash: r.systemHash,
      endReason: r.endReason,
    }))
  }

  async function listTimeline(input: ListTimelineInput): Promise<TimelineEvent[]> {
    const rows = (await db
      .select({
        id: conversationEvents.id,
        ts: conversationEvents.ts,
        type: conversationEvents.type,
        role: conversationEvents.role,
        turnIndex: conversationEvents.turnIndex,
        toolName: conversationEvents.toolName,
        content: conversationEvents.content,
        toolCalls: conversationEvents.toolCalls,
        payload: conversationEvents.payload,
        costUsd: conversationEvents.costUsd,
        latencyMs: conversationEvents.latencyMs,
        organizationId: conversationEvents.organizationId,
      })
      .from(conversationEvents)
      .where(
        and(eq(conversationEvents.wakeId, input.wakeId), eq(conversationEvents.organizationId, input.organizationId)),
      )
      .orderBy(conversationEvents.ts)) as unknown as Array<{
      id: bigint | string
      ts: Date
      type: string
      role: string | null
      turnIndex: number
      toolName: string | null
      content: string | null
      toolCalls: unknown
      payload: unknown
      costUsd: string | number | null
      latencyMs: number | null
    }>

    return rows.map((r) => ({
      id: String(r.id),
      ts: r.ts,
      type: r.type,
      role: r.role,
      turnIndex: r.turnIndex,
      toolName: r.toolName,
      contentPreview: previewContent(r.content, input.full),
      toolCalls: r.toolCalls,
      payload: r.payload,
      costUsd: r.costUsd === null ? null : Number(r.costUsd),
      latencyMs: r.latencyMs,
    }))
  }

  function previewContent(content: string | null, full: boolean | undefined): string | null {
    if (!content || full) return content
    return content.length > TIMELINE_PREVIEW_BYTES ? `${content.slice(0, TIMELINE_PREVIEW_BYTES)}…` : content
  }

  async function listLlmIo(input: ListLlmIoInput): Promise<LlmIoRow[]> {
    if (!input.conversationId && !input.wakeId) {
      throw new Error('agents/debug-readers.listLlmIo: --conversationId or --wakeId is required')
    }

    // MIN/MAX(ts) brackets the entire wake even if `agent_end` never fired.
    let conversationId = input.conversationId ?? null
    let wakeWindow: { from: Date; to: Date } | null = null
    if (input.wakeId) {
      const wakeRows = (await db.execute(sql`
        SELECT
          MAX(conversation_id) AS "conversationId",
          MIN(ts) AS "fromTs",
          MAX(ts) AS "toTs"
        FROM harness.conversation_events
        WHERE wake_id = ${input.wakeId}
          AND organization_id = ${input.organizationId}
      `)) as unknown as Array<{
        conversationId: string | null
        fromTs: Date | string | null
        toTs: Date | string | null
      }>
      const wake = wakeRows[0]
      if (!wake?.conversationId || !wake.fromTs || !wake.toTs) return []
      conversationId = wake.conversationId
      wakeWindow = {
        from: wake.fromTs instanceof Date ? wake.fromTs : new Date(wake.fromTs),
        to: wake.toTs instanceof Date ? wake.toTs : new Date(wake.toTs),
      }
    }
    if (!conversationId) return []

    // Org-safety via the `agent_definitions` join. Threads are 1:1 per
    // (agent, conversation).
    const threadRows = (await db.execute(sql`
      SELECT t.id AS "threadId"
      FROM harness.threads t
      JOIN agents.agent_definitions a ON a.id = t.agent_id
      WHERE t.conversation_id = ${conversationId}
        AND a.organization_id = ${input.organizationId}
      LIMIT 1
    `)) as unknown as Array<{ threadId: string }>
    const thread = threadRows[0]
    if (!thread) return []

    const limit = Math.min(Math.max(input.limit ?? 30, 1), 200)

    // Most-recent rows by seq, then re-sort ascending so the operator reads
    // top-to-bottom in turn order.
    const seqLowerSql = input.seqFrom !== undefined ? sql`AND seq >= ${input.seqFrom}` : sql``
    const seqUpperSql = input.seqTo !== undefined ? sql`AND seq <= ${input.seqTo}` : sql``
    const fromTsSql = wakeWindow ? sql`AND created_at >= ${wakeWindow.from.toISOString()}` : sql``
    const toTsSql = wakeWindow ? sql`AND created_at <= ${wakeWindow.to.toISOString()}` : sql``
    const rawRows = (await db.execute(sql`
      SELECT seq, payload, created_at AS "createdAt"
      FROM harness.messages
      WHERE thread_id = ${thread.threadId}
        ${seqLowerSql}
        ${seqUpperSql}
        ${fromTsSql}
        ${toTsSql}
      ORDER BY seq DESC
      LIMIT ${limit}
    `)) as unknown as Array<{ seq: number; payload: unknown; createdAt: Date | string }>

    let rows = rawRows.map((r) => projectLlmIoRow(r, input.full)).reverse() // ascending by seq

    if (input.role) rows = rows.filter((r) => r.role === input.role)
    if (input.tool) rows = rows.filter((r) => r.toolName === input.tool)

    return rows
  }

  async function waitForWake(input: WaitForWakeInput): Promise<WaitForWakeResult> {
    const pollMs = Math.min(Math.max(input.pollMs ?? 1500, 250), 10_000)
    const startWall = Date.now()
    const deadline = startWall + Math.max(input.timeoutMs, 0)
    const sinceIso = input.since.toISOString()

    // One probe per tick: find the target wake (earliest agent_start after the
    // watermark), then aggregate it; settle as soon as an agent_end appears.
    for (;;) {
      const startRows = (await db.execute(sql`
        SELECT wake_id AS "wakeId"
        FROM harness.conversation_events
        WHERE conversation_id = ${input.conversationId}
          AND organization_id = ${input.organizationId}
          AND type = 'agent_start'
          AND wake_id IS NOT NULL
          AND ts >= ${sinceIso}
        ORDER BY ts ASC
        LIMIT 1
      `)) as unknown as Array<{ wakeId: string | null }>
      const wakeId = startRows[0]?.wakeId ?? null

      if (wakeId) {
        const aggRows = (await db.execute(sql`
          SELECT
            bool_or(type = 'agent_end') AS "ended",
            MAX(CASE WHEN type = 'agent_start' THEN payload ->> 'trigger' END) AS "trigger",
            MAX(CASE WHEN type = 'agent_end' THEN payload ->> 'reason' END) AS "endReason",
            MIN(ts) AS "startedAt",
            MAX(CASE WHEN type = 'agent_end' THEN ts END) AS "endedAt",
            COALESCE(MAX(turn_index), 0) + 1 AS "turns",
            COUNT(*) FILTER (WHERE type = 'tool_dispatch_started') AS "toolCalls",
            COALESCE(SUM(cost_usd), 0) AS "costUsd"
          FROM harness.conversation_events
          WHERE wake_id = ${wakeId}
            AND organization_id = ${input.organizationId}
        `)) as unknown as Array<{
          ended: boolean | null
          trigger: string | null
          endReason: string | null
          startedAt: Date | string | null
          endedAt: Date | string | null
          turns: number | string
          toolCalls: number | string
          costUsd: number | string
        }>
        const agg = aggRows[0]
        if (agg?.ended) {
          return {
            status: 'settled',
            wakeId,
            trigger: agg.trigger,
            endReason: agg.endReason,
            turns: Number(agg.turns),
            toolCalls: Number(agg.toolCalls),
            costUsd: Number(agg.costUsd),
            startedAt: toDate(agg.startedAt),
            endedAt: toDate(agg.endedAt),
            toolCallDetail: await readWakeToolCalls(wakeId, input.organizationId),
            waitedMs: Date.now() - startWall,
          }
        }
      }

      if (Date.now() >= deadline) {
        return {
          status: wakeId ? 'timeout' : 'no_wake',
          wakeId,
          trigger: null,
          endReason: null,
          turns: 0,
          toolCalls: 0,
          costUsd: 0,
          startedAt: null,
          endedAt: null,
          toolCallDetail: [],
          waitedMs: Date.now() - startWall,
        }
      }
      await Bun.sleep(pollMs)
    }
  }

  async function readWakeToolCalls(wakeId: string, organizationId: string): Promise<WakeToolCall[]> {
    // Arguments live on `tool_execution_start.payload.args` (e.g. bash →
    // `args.command`, reply_contact → `args.text`). `tool_dispatch_started`
    // carries only the tool name, so reading it would surface null args.
    const rows = (await db
      .select({
        toolName: conversationEvents.toolName,
        payload: conversationEvents.payload,
      })
      .from(conversationEvents)
      .where(
        and(
          eq(conversationEvents.wakeId, wakeId),
          eq(conversationEvents.organizationId, organizationId),
          eq(conversationEvents.type, 'tool_execution_start'),
        ),
      )
      .orderBy(conversationEvents.ts)) as unknown as Array<{
      toolName: string | null
      payload: unknown
    }>
    return rows.map((r) => ({
      toolName: r.toolName ?? '(unknown)',
      argsPreview: previewJsonb((r.payload as { args?: unknown } | null)?.args ?? null, 200),
    }))
  }

  return { listWakes, listTimeline, listLlmIo, waitForWake }
}

function toDate(v: Date | string | null): Date | null {
  if (v === null || v === undefined) return null
  return v instanceof Date ? v : new Date(v)
}

// Operates on the verbatim payload (not a projected `LlmIoRow`) so `--tool`
// filtering still works after `--full=false` truncates the row's payload.
function extractToolNameFromPayload(payload: Record<string, unknown>): string | null {
  if (typeof payload.toolName === 'string') return payload.toolName
  const content = payload.content as Array<Record<string, unknown>> | undefined
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.type === 'toolCall' && typeof part.name === 'string') return part.name
    }
  }
  return null
}

const LLM_IO_PREVIEW_BYTES = 200

function projectLlmIoRow(
  raw: { seq: number; payload: unknown; createdAt: Date | string },
  full: boolean | undefined,
): LlmIoRow {
  const payload = (raw.payload ?? {}) as Record<string, unknown>
  const usage = (payload.usage ?? {}) as {
    input?: number
    output?: number
    cacheRead?: number
    cost?: { total?: number }
  }
  const role = typeof payload.role === 'string' ? payload.role : 'unknown'
  return {
    seq: raw.seq,
    role,
    model: typeof payload.model === 'string' ? payload.model : null,
    tokensIn: typeof usage.input === 'number' ? usage.input : null,
    tokensOut: typeof usage.output === 'number' ? usage.output : null,
    cacheReadTokens: typeof usage.cacheRead === 'number' ? usage.cacheRead : null,
    costUsd: typeof usage.cost?.total === 'number' ? usage.cost.total : null,
    toolName: extractToolNameFromPayload(payload),
    preview: buildLlmIoPreview(role, payload),
    payload: full ? raw.payload : { truncated: true },
    createdAt: raw.createdAt instanceof Date ? raw.createdAt : new Date(raw.createdAt),
  }
}

function buildLlmIoPreview(role: string, payload: Record<string, unknown>): string {
  const content = payload.content as Array<Record<string, unknown>> | undefined
  if (role === 'toolResult') {
    const toolName = typeof payload.toolName === 'string' ? payload.toolName : 'tool'
    const text = firstTextFragment(content)
    return truncate(`${toolName} → ${text ?? '(no text)'}`, LLM_IO_PREVIEW_BYTES)
  }
  if (role === 'assistant' && Array.isArray(content)) {
    const toolCall = content.find((c) => c?.type === 'toolCall')
    if (toolCall) {
      const name = typeof toolCall.name === 'string' ? toolCall.name : 'tool'
      const args = toolCall.arguments
      const argsPreview = args === undefined ? '' : truncate(JSON.stringify(args), 80)
      return truncate(`${name}(${argsPreview})`, LLM_IO_PREVIEW_BYTES)
    }
  }
  return truncate(firstTextFragment(content) ?? '(no text)', LLM_IO_PREVIEW_BYTES)
}

function firstTextFragment(content: Array<Record<string, unknown>> | undefined): string | null {
  if (!Array.isArray(content)) return null
  for (const part of content) {
    if (typeof part?.text === 'string' && part.text.trim().length > 0) {
      return part.text.replace(/\s+/g, ' ').trim()
    }
  }
  return null
}

function truncate(s: string, maxBytes: number): string {
  if (s.length <= maxBytes) return s
  return `${s.slice(0, maxBytes)}…`
}

// ─── Singleton + free-function wrappers ──────────────────────────────────────

let _current: DebugReadersService | null = null

export function installDebugReadersService(svc: DebugReadersService): void {
  _current = svc
}

export function __resetDebugReadersServiceForTests(): void {
  _current = null
}

function current(): DebugReadersService {
  if (!_current) {
    throw new Error('agents/debug-readers: service not installed — call installDebugReadersService() in module init')
  }
  return _current
}

export function listWakes(input: ListWakesInput): Promise<WakeSummary[]> {
  return current().listWakes(input)
}

export function listTimeline(input: ListTimelineInput): Promise<TimelineEvent[]> {
  return current().listTimeline(input)
}

export function listLlmIo(input: ListLlmIoInput): Promise<LlmIoRow[]> {
  return current().listLlmIo(input)
}

export function waitForWake(input: WaitForWakeInput): Promise<WaitForWakeResult> {
  return current().waitForWake(input)
}
