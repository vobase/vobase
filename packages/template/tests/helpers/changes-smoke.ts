/**
 * Building-block helpers for interactively smoke-testing the changes
 * propose → decide → wake pipeline against a live dev server. Each helper
 * is one atomic operation; compose by hand to inspect agent reactions
 * between steps rather than batching the whole flow.
 *
 * Usage (from a `bun -e` shell or repl):
 *   import { open, sendInbound, waitForReply, insertPending, decide,
 *            listJournal, listActivity, devLogin } from './changes-smoke'
 *   const ctx = await open()
 *   const conv = await sendInbound(ctx, 'Hi I am Marc')
 *   await waitForReply(ctx, conv.conversationId, 0)
 *   const pid = await insertPending(ctx, {...})
 *   await decide(ctx, pid, 'approved')
 *   await waitForReply(ctx, conv.conversationId, 1)
 *
 * Requires: dev server on $BASE_URL (default http://localhost:3000) and a
 * Postgres reachable via $DATABASE_URL.
 */

import { createHmac } from 'node:crypto'
import postgres, { type Sql } from 'postgres'

import { devLogin as devLoginRaw, makeAuthedFetch, type SmokeAuth } from '../smoke/_helpers'

export interface SmokeCtx {
  baseUrl: string
  channelInstanceId: string
  organizationId: string
  webhookSecret: string
  /** External-from id used to identify the simulated customer to the channel. */
  from: string
  sql: Sql
  auth: SmokeAuth
  /** Cookie-injecting fetch wrapper for staff-authed API calls. */
  authedFetch: ReturnType<typeof makeAuthedFetch>
}

export interface OpenOpts {
  baseUrl?: string
  organizationId?: string
  channelInstanceId?: string
  /** Override env-loaded webhook secret. */
  webhookSecret?: string
  /** Stable external customer id; defaults to `smoke-<ts>`. */
  from?: string
  /** Staff email to dev-login as. */
  staffEmail?: string
}

/**
 * Bootstraps a smoke context: opens a Postgres client, dev-logs-in as a
 * staff user, captures the auth cookie. Caller is responsible for
 * `await ctx.sql.end()` when finished.
 */
export async function open(opts: OpenOpts = {}): Promise<SmokeCtx> {
  const baseUrl = opts.baseUrl ?? process.env.BASE_URL ?? 'http://localhost:3000'
  const organizationId = opts.organizationId ?? process.env.ORG_ID ?? 'mer0tenant'
  const channelInstanceId = opts.channelInstanceId ?? process.env.CHANNEL_INSTANCE_ID ?? 'chi00web00'
  // Use `||` not `??`: Bun loads .env which sets the var to the empty string,
  // and `??` would propagate "" while the server's HMAC verifier falls through
  // empty to its 'dev-secret' fallback — mismatch → 401.
  const webhookSecret = opts.webhookSecret || process.env.CHANNEL_WEB_WEBHOOK_SECRET || 'dev-secret'
  const from = opts.from ?? `smoke-${Date.now()}`
  const sql = postgres(process.env.DATABASE_URL ?? 'postgres://vobase:vobase@localhost:5432/vobase')
  const auth = await devLoginRaw(baseUrl, opts.staffEmail ?? 'alice@meridian.test')
  const authedFetch = makeAuthedFetch(baseUrl, auth)
  return { baseUrl, channelInstanceId, organizationId, webhookSecret, from, sql, auth, authedFetch }
}

export async function close(ctx: SmokeCtx): Promise<void> {
  await ctx.sql.end()
}

export interface InboundResult {
  conversationId: string
  contactId: string
  messageId: string
}

/**
 * Posts an HMAC-signed inbound web message. Repeat calls with the same
 * `ctx.from` reuse the same contact + conversation, simulating a multi-turn
 * customer thread.
 */
export async function sendInbound(ctx: SmokeCtx, content: string): Promise<InboundResult> {
  const body = JSON.stringify({
    channelType: 'web',
    organizationId: ctx.organizationId,
    from: ctx.from,
    profileName: 'Smoke Customer',
    content,
    contentType: 'text',
    externalMessageId: `${ctx.from}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  })
  const sig = `sha256=${createHmac('sha256', ctx.webhookSecret).update(body).digest('hex')}`
  const res = await fetch(`${ctx.baseUrl}/api/channels/adapters/web/inbound`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-channel-instance-id': ctx.channelInstanceId,
      'x-hub-signature-256': sig,
    },
    body,
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`inbound ${res.status}: ${txt}`)
  const payload = JSON.parse(txt) as { conversationId: string; messageId: string }
  const rows = await ctx.sql<{ contact_id: string }[]>`
    SELECT contact_id FROM messaging.conversations WHERE id = ${payload.conversationId}
  `
  return { conversationId: payload.conversationId, messageId: payload.messageId, contactId: rows[0].contact_id }
}

export interface AgentReply {
  id: string
  text: string
  createdAt: Date
}

/**
 * Polls `messaging.messages` until the count of `role = 'agent'` rows for
 * `conversationId` exceeds `afterCount`. Returns the latest reply (text +
 * id + createdAt).
 *
 * Throws on `timeoutS` (default 90s) so a stuck wake fails fast.
 */
export async function waitForReply(
  ctx: SmokeCtx,
  conversationId: string,
  afterCount: number,
  opts: { timeoutS?: number; quiet?: boolean } = {},
): Promise<AgentReply> {
  const timeoutS = opts.timeoutS ?? 90
  for (let i = 0; i < timeoutS; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    const rows = await ctx.sql<{ id: string; role: string; text: string | null; created_at: Date }[]>`
      SELECT id, role, content->>'text' AS text, created_at
      FROM messaging.messages
      WHERE conversation_id = ${conversationId}
      ORDER BY created_at ASC
    `
    const replies = rows.filter((m) => m.role === 'agent')
    if (replies.length > afterCount) {
      const latest = replies[replies.length - 1]
      return { id: latest.id, text: latest.text ?? '', createdAt: latest.created_at }
    }
    if (!opts.quiet && i > 0 && i % 15 === 0) {
      console.log(`[waitForReply] ${i}s — replies=${replies.length} (need >${afterCount})`)
    }
  }
  throw new Error(`waitForReply timed out after ${timeoutS}s (need >${afterCount} replies)`)
}

export interface InsertPendingOpts {
  contactId: string
  conversationId: string
  /** Top-level scalar field on the contact (e.g. 'email', 'displayName'). */
  field: 'email' | 'displayName' | 'phone'
  value: string
  rationale: string
  /** Override the prefix-`tst` random id. */
  proposalId?: string
}

/**
 * Direct INSERT into `changes.change_proposals` with `conversation_id` set,
 * bypassing the agent. Lets the smoke exercise decide → wake even when the
 * model declines to attempt the edit itself. Mirrors the shape produced by
 * the workspace-sync observer (`{kind:'field_set', fields:{<key>:{from,to}}}`).
 */
export async function insertPending(ctx: SmokeCtx, opts: InsertPendingOpts): Promise<string> {
  const proposalId = opts.proposalId ?? `tst${Math.random().toString(36).slice(2, 7).padEnd(5, '0')}`
  await ctx.sql`
    INSERT INTO changes.change_proposals (
      id, organization_id, resource_module, resource_type, resource_id,
      payload, status, rationale, conversation_id,
      proposed_by_id, proposed_by_kind, created_at
    ) VALUES (
      ${proposalId}, ${ctx.organizationId}, 'contacts', 'contact', ${opts.contactId},
      ${ctx.sql.json({ kind: 'field_set', fields: { [opts.field]: { from: null, to: opts.value } } })},
      'pending', ${opts.rationale}, ${opts.conversationId},
      'agt0meri0v1', 'agent', now()
    )
  `
  return proposalId
}

export interface DecideResult {
  ok: boolean
  id: string
  status: 'approved' | 'rejected'
  appliedHistoryId: string | null
}

/**
 * POSTs the decide endpoint with the smoke's auth cookie. The handler
 * persists the decision then enqueues `changes:decided-to-wake` so the
 * agent wakes for an in-conversation acknowledgement.
 */
export async function decide(
  ctx: SmokeCtx,
  proposalId: string,
  decision: 'approved' | 'rejected',
  note?: string,
): Promise<DecideResult> {
  const res = await ctx.authedFetch(`/api/changes/proposals/${proposalId}/decide`, {
    method: 'POST',
    body: JSON.stringify({ decision, decidedByUserId: ctx.auth.userId, note }),
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`decide ${decision} ${proposalId} → ${res.status}: ${txt}`)
  return JSON.parse(txt) as DecideResult
}

export interface JournalEvent {
  type: string
  ts: Date
  toolName: string | null
}

/** All harness journal events for a conversation, in `ts` order. */
export async function listJournal(ctx: SmokeCtx, conversationId: string): Promise<JournalEvent[]> {
  return ctx.sql<JournalEvent[]>`
    SELECT type, ts, tool_name AS "toolName"
    FROM harness.conversation_events
    WHERE conversation_id = ${conversationId}
    ORDER BY ts ASC
  `
}

export interface ActivityEvent {
  type: string
  createdAt: string
  payload: unknown
}

/**
 * Pulls `/api/messaging/conversations/:id/activity`, the API the inbox UI
 * reads. Useful for confirming `change.proposed/auto_applied/approved/
 * rejected` events render as expected to staff.
 */
export async function listActivity(ctx: SmokeCtx, conversationId: string): Promise<ActivityEvent[]> {
  const res = await ctx.authedFetch(`/api/messaging/conversations/${conversationId}/activity`)
  const txt = await res.text()
  if (!res.ok) throw new Error(`activity ${res.status}: ${txt}`)
  return JSON.parse(txt) as ActivityEvent[]
}

/**
 * Inspect the agent transcript for one conversation by walking the harness
 * thread. Returns each turn's role + a short kind ('reply', 'bash', 'text',
 * 'toolResult') + a body excerpt for quick eyeballing.
 */
export interface TranscriptRow {
  seq: number
  role: string
  kind: string
  body: string
}

export async function listTranscript(ctx: SmokeCtx, conversationId: string): Promise<TranscriptRow[]> {
  return ctx.sql<TranscriptRow[]>`
    SELECT
      m.seq,
      m.payload->>'role' AS role,
      COALESCE(
        m.payload->'content'->0->>'name',
        m.payload->'content'->0->>'type'
      ) AS kind,
      substring(
        COALESCE(
          m.payload->'content'->0->>'text',
          m.payload->'content'->0->'arguments'->>'text',
          m.payload->'content'->0->'arguments'->>'command'
        ),
        1, 250
      ) AS body
    FROM harness.messages m
    JOIN harness.threads t ON t.id = m.thread_id
    WHERE t.conversation_id = ${conversationId}
    ORDER BY m.seq ASC
  `
}

export { devLoginRaw as devLogin, type SmokeAuth }
