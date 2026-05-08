/**
 * Shared runtime for live smokes (`tests/smoke/smoke-*-live.ts`).
 *
 * Every smoke historically reinvented: opening a postgres client, parsing the
 * assistant payload (`{type:'text'}`/`{type:'toolCall'}`), polling
 * `harness.messages` for new assistant turns, and printing an opaque "❌ timed
 * out" on failure. This module collapses all of that into one importable seam
 * and — crucially — makes failure inspection meaningful by dumping the actual
 * conversation transcript: customer messages, agent text, tool calls *with
 * arguments*, tool results (including bash exit/stderr), the journal sequence,
 * and any change proposals/lifecycle events.
 *
 * Canonical pi-ai message shapes (see `@mariozechner/pi-ai/dist/types.d.ts`):
 *   - assistant: `{ role:'assistant', content: [{type:'text',text} | {type:'thinking'} | {type:'toolCall',id,name,arguments}] }`
 *   - toolResult: `{ role:'toolResult', toolCallId, toolName, content:[{type:'text',text}], isError }`
 */

import type { Sql } from 'postgres'
import postgres from 'postgres'

// ─── Constants ───────────────────────────────────────────────────────────────

/** The seeded MeriGPT agent id. Many smokes hardcoded this; centralised here. */
export const SMOKE_AGENT_ID = 'agt0meri0v1'

/** Per-trigger sensible default timeouts (seconds). */
export const POLL_S_DEFAULTS = {
  inbound: 60,
  heartbeat: 90,
  operator: 90,
  staffNote: 120,
  conversation: 120,
  learning: 180,
} as const

/** Read `POLL_S` (or a custom env name) with a fallback. */
export function envPollS(fallback: number, name = 'POLL_S'): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

// ─── Connection ──────────────────────────────────────────────────────────────

export interface SmokeDbHandle {
  sql: Sql
  end: () => Promise<void>
}

/** Opens a single postgres client for the lifetime of one smoke script. */
export function connectSmokeDb(): SmokeDbHandle {
  const url = process.env.DATABASE_URL ?? 'postgres://vobase:vobase@localhost:5432/vobase'
  const sql = postgres(url, { max: 5 })
  return {
    sql,
    end: async () => {
      await sql.end()
    },
  }
}

// ─── Payload extractors ──────────────────────────────────────────────────────

/**
 * Walks an assistant-message `content` array and returns the joined text of
 * every `{type:'text'}` part. Empty string when none.
 */
export function pickText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const p = payload as Record<string, unknown>
  if (typeof p.content === 'string') return p.content
  if (!Array.isArray(p.content)) return ''
  const parts: string[] = []
  for (const c of p.content) {
    if (!c || typeof c !== 'object') continue
    const obj = c as Record<string, unknown>
    if (obj.type === 'text' && typeof obj.text === 'string') parts.push(obj.text)
  }
  return parts.join('\n')
}

export interface ToolCallView {
  id: string
  name: string
  arguments: unknown
}

/** Returns every `{type:'toolCall'}` part in payload order. */
export function pickToolCalls(payload: unknown): ToolCallView[] {
  if (!payload || typeof payload !== 'object') return []
  const p = payload as Record<string, unknown>
  if (!Array.isArray(p.content)) return []
  const out: ToolCallView[] = []
  for (const c of p.content) {
    if (!c || typeof c !== 'object') continue
    const obj = c as Record<string, unknown>
    if (obj.type === 'toolCall') {
      const id = typeof obj.id === 'string' ? obj.id : ''
      const name = typeof obj.name === 'string' ? obj.name : ''
      out.push({ id, name, arguments: obj.arguments })
    }
  }
  return out
}

// ─── Polling ─────────────────────────────────────────────────────────────────

export interface AssistantTurnRow {
  id: string
  seq: number
  payload: unknown
  createdAt: Date
}

export interface PollAssistantOpts {
  sql: Sql
  conversationId: string
  /** Number of assistant turns already present before the trigger. */
  baseline: number
  /** Seconds to wait. */
  timeoutS: number
  /** Optional log prefix, e.g. `[smoke:inbound]`. */
  label?: string
  /** Called every poll iteration with the current assistant-turn count. */
  onTick?: (count: number, elapsedS: number) => void
}

/**
 * Polls `harness.messages` (joined via `harness.threads`) until the assistant
 * turn count exceeds `baseline`, with exponential backoff (1s → 3s cap) so a
 * long timeout doesn't hammer the DB. Returns every new turn (in `seq` order).
 *
 * Throws on timeout — let `runSmoke` catch and dump diagnostics.
 */
export async function pollAssistantTurns(opts: PollAssistantOpts): Promise<AssistantTurnRow[]> {
  const { sql, conversationId, baseline, timeoutS, label, onTick } = opts
  const deadline = Date.now() + timeoutS * 1000
  let waitMs = 1000
  const start = Date.now()
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, waitMs))
    waitMs = Math.min(3000, Math.floor(waitMs * 1.5))
    const rows = await sql<AssistantTurnRow[]>`
      SELECT m.id, m.seq, m.payload, m.created_at AS "createdAt"
      FROM harness.messages m
      JOIN harness.threads t ON t.id = m.thread_id
      WHERE t.conversation_id = ${conversationId}
        AND m.payload->>'role' = 'assistant'
      ORDER BY m.seq ASC
    `
    const elapsedS = Math.floor((Date.now() - start) / 1000)
    onTick?.(rows.length, elapsedS)
    if (rows.length > baseline) return rows.slice(baseline)
    if (label && elapsedS > 0 && elapsedS % 15 === 0) {
      console.log(`${label} …${elapsedS}s, assistant turns=${rows.length} (need >${baseline})`)
    }
  }
  throw new Error(
    `pollAssistantTurns timed out after ${timeoutS}s on conversation=${conversationId} (need >${baseline} assistant turns)`,
  )
}

/** Convenience: how many assistant turns currently exist for a conversation. */
export async function countAssistantTurns(sql: Sql, conversationId: string): Promise<number> {
  const rows = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM harness.messages m
    JOIN harness.threads t ON t.id = m.thread_id
    WHERE t.conversation_id = ${conversationId}
      AND m.payload->>'role' = 'assistant'
  `
  return rows[0]?.count ?? 0
}

// ─── Diagnostic dump ─────────────────────────────────────────────────────────

interface MessagingMessageRow {
  id: string
  role: string
  content: unknown
  created_at: Date
}

interface JournalMessageRow {
  id: string
  seq: number
  payload: unknown
}

interface JournalEventRow {
  type: string
  ts: Date
  tool_name: string | null
  turn_index: number | null
}

interface ProposalRow {
  id: string
  resource_module: string
  resource_type: string
  resource_id: string
  status: string
  rationale: string | null
  payload: unknown
}

interface LifecycleEventRow {
  type: string
  ts: Date
  payload: unknown
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return `${s.slice(0, n)}…`
}

function indent(text: string, prefix = '    '): string {
  return text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n')
}

function previewArgs(args: unknown, max = 200): string {
  if (args === undefined || args === null) return ''
  if (typeof args === 'string') return truncate(args, max)
  // Bash tool: surface the command verbatim — that's the whole reason this
  // helper exists.
  if (typeof args === 'object' && args !== null) {
    const obj = args as Record<string, unknown>
    if (typeof obj.command === 'string') return truncate(obj.command, max)
    if (typeof obj.text === 'string') return truncate(obj.text, max)
  }
  try {
    return truncate(JSON.stringify(args), max)
  } catch {
    return '(unserialisable)'
  }
}

function formatToolResult(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '(empty)'
  const p = payload as Record<string, unknown>
  const isError = p.isError === true
  const tag = isError ? 'error' : 'ok'
  const toolName = typeof p.toolName === 'string' ? p.toolName : '?'
  if (!Array.isArray(p.content)) return `[${tag}] ${toolName}`
  const text = p.content
    .map((c) => (c && typeof c === 'object' && (c as { text?: unknown }).text) || '')
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
    .join('\n')
  return `[${tag}] ${toolName} ${truncate(text, 600)}`
}

export interface DumpOpts {
  /** Max number of journal messages to render (assistant + toolResult). Default 12. */
  messagesLimit?: number
  /** Skip the messaging.messages dump (e.g. for operator-thread / heartbeat lanes that have no customer messages). */
  skipMessaging?: boolean
}

/**
 * Prints a readable forensic dump for one conversation: the customer-facing
 * messages, the agent's full journal turns (text + tool calls *with arguments*
 * + tool results), the harness journal sequence, and any change proposals /
 * lifecycle events. This is the only failure-reporting path smokes should use.
 */
export async function dumpConversationState(
  sql: Sql,
  conversationId: string,
  opts: DumpOpts = {},
): Promise<void> {
  const messagesLimit = opts.messagesLimit ?? 12
  console.error(`\n─── conversation ${conversationId} ───`)

  if (!opts.skipMessaging) {
    try {
      const messages = await sql<MessagingMessageRow[]>`
        SELECT id, role, content, created_at
        FROM messaging.messages
        WHERE conversation_id = ${conversationId}
        ORDER BY created_at ASC
      `
      if (messages.length === 0) {
        console.error('[messaging] (no messages)')
      } else {
        for (const m of messages) {
          const text = pickText({ content: (m.content as { content?: unknown })?.content ?? m.content })
          const display = text || `(${m.role}, non-text payload)`
          console.error(`[${m.role}] ${truncate(display.replace(/\n/g, ' '), 300)}`)
        }
      }
    } catch (err) {
      console.error(`[messaging] dump failed: ${(err as Error).message}`)
    }
  }

  // Journal messages: the agent's turns + tool results, in seq order.
  try {
    const journal = await sql<JournalMessageRow[]>`
      SELECT m.id, m.seq, m.payload
      FROM harness.messages m
      JOIN harness.threads t ON t.id = m.thread_id
      WHERE t.conversation_id = ${conversationId}
        AND m.payload->>'role' IN ('assistant', 'toolResult')
      ORDER BY m.seq ASC
    `
    const slice = journal.slice(-messagesLimit)
    if (journal.length > slice.length) {
      console.error(`[journal] showing last ${slice.length} of ${journal.length} turns`)
    }
    for (const row of slice) {
      const payload = row.payload as Record<string, unknown> | null
      const role = (payload?.role as string | undefined) ?? '?'
      if (role === 'assistant') {
        const text = pickText(payload)
        const calls = pickToolCalls(payload)
        if (text) console.error(`[assistant seq=${row.seq}] ${truncate(text.replace(/\n/g, ' '), 400)}`)
        for (const call of calls) {
          console.error(`[assistant seq=${row.seq}] (tool: ${call.name}) ${previewArgs(call.arguments, 240)}`)
        }
        if (!text && calls.length === 0) console.error(`[assistant seq=${row.seq}] (empty payload)`)
      } else if (role === 'toolResult') {
        console.error(`[tool result seq=${row.seq}] ${formatToolResult(payload)}`)
      }
    }
  } catch (err) {
    console.error(`[journal] dump failed: ${(err as Error).message}`)
  }

  // Harness journal events — readable single-line sequence.
  try {
    const events = await sql<JournalEventRow[]>`
      SELECT type, ts, tool_name, turn_index
      FROM harness.conversation_events
      WHERE conversation_id = ${conversationId}
      ORDER BY ts ASC
    `
    if (events.length > 0) {
      const seq = events
        .map((e) => (e.tool_name ? `${e.type}(${e.tool_name})` : e.type))
        .join(' → ')
      console.error(`[journal events] ${truncate(seq, 800)}`)
    } else {
      console.error('[journal events] (none)')
    }
  } catch (err) {
    console.error(`[journal events] dump failed: ${(err as Error).message}`)
  }

  // Proposals + change.* lifecycle.
  try {
    const proposals = await sql<ProposalRow[]>`
      SELECT id, resource_module, resource_type, resource_id, status, rationale, payload
      FROM changes.change_proposals
      WHERE conversation_id = ${conversationId}
      ORDER BY created_at ASC
    `
    if (proposals.length === 0) {
      console.error('[proposals] (none)')
    } else {
      for (const p of proposals) {
        console.error(
          `[proposal] [${p.status}] ${p.id} ${p.resource_module}.${p.resource_type}#${p.resource_id} — ${truncate(p.rationale ?? '', 120)}`,
        )
        console.error(indent(truncate(JSON.stringify(p.payload), 240)))
      }
    }
  } catch (err) {
    console.error(`[proposals] dump failed: ${(err as Error).message}`)
  }

  try {
    const lifecycle = await sql<LifecycleEventRow[]>`
      SELECT type, ts, payload
      FROM harness.conversation_events
      WHERE conversation_id = ${conversationId} AND type LIKE 'change.%'
      ORDER BY ts ASC
    `
    if (lifecycle.length === 0) {
      console.error('[change events] (none)')
    } else {
      for (const e of lifecycle) {
        const summary = (e.payload as { summary?: unknown })?.summary
        console.error(`[change event] ${e.ts.toISOString()} ${e.type} ${truncate(String(summary ?? ''), 200)}`)
      }
    }
  } catch (err) {
    console.error(`[change events] dump failed: ${(err as Error).message}`)
  }
  console.error('─── end dump ───\n')
}

// ─── Top-level wrapper ───────────────────────────────────────────────────────

export interface SmokeRunCtx {
  baseUrl: string
}

export interface RunSmokeOpts {
  /**
   * Conversation id(s) to dump on failure. Called after `fn` throws, so the
   * body can return a closure capturing whatever ids it discovered.
   * The dump opens its own short-lived connection (via `connectSmokeDb`).
   */
  dumpOnFailure?: () => string[] | Promise<string[]>
  /** Per-conversation dump options forwarded to `dumpConversationState`. */
  dumpOpts?: DumpOpts
}

/**
 * Top-level smoke wrapper: runs `fn`, on any throw dumps each tracked
 * conversation's full state (customer messages + agent turns + tool calls
 * with arguments + journal sequence + proposals/lifecycle), and `process.exit`s
 * with the right code. The body owns its own DB connection (smokes typically
 * open one via `connectSmokeDb` or `open()` from `changes-smoke`).
 */
export async function runSmoke(
  name: string,
  fn: (ctx: SmokeRunCtx) => Promise<void>,
  opts: RunSmokeOpts = {},
): Promise<never> {
  const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000'
  console.log(`[smoke:${name}] target=${baseUrl}`)
  try {
    await fn({ baseUrl })
    console.log(`\n[smoke:${name}] ✅ ok`)
    process.exit(0)
  } catch (err) {
    console.error(`\n[smoke:${name}] ❌ ${(err as Error).message}`)
    if ((err as Error).stack) console.error((err as Error).stack)
    try {
      const ids = (await opts.dumpOnFailure?.()) ?? []
      if (ids.length > 0) {
        const handle = connectSmokeDb()
        try {
          for (const id of ids) {
            await dumpConversationState(handle.sql, id, opts.dumpOpts)
          }
        } finally {
          await handle.end()
        }
      }
    } catch (dumpErr) {
      console.error(`[smoke:${name}] dump failed: ${(dumpErr as Error).message}`)
    }
    process.exit(1)
  }
}
