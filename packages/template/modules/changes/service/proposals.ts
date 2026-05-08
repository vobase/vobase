import { conversations } from '@modules/messaging/schema'
import { appendJournalEvent } from '@modules/messaging/service/journal'
import type { ChangePayload } from '@vobase/core'
import {
  conflict,
  journalGetLatestTurnIndex as getLatestTurnIndex,
  notFound,
  VobaseError,
  validation,
} from '@vobase/core'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'

import type { RealtimeService } from '~/runtime'
import type { AgentEvent } from '~/wake/events'
import { LEARNING_TRIAGE_JOB, type LearningTriageJobPayload } from '~/wake/learning/triage-job'
import {
  type ChangedByKind,
  type ChangeHistoryRow,
  type ChangeProposalInboxItem,
  type ChangeProposalRow,
  type ChangeStatus,
  changeHistory,
  changeProposals,
} from '../schema'
import { summarizeLifecycleEvent } from './lifecycle-summary'
import { effectiveSensitivity, routeStatus, type Sensitivity } from './sensitivity'

/**
 * Narrow port: publishes one learning-triage job per call. Decoupled from
 * concrete pg-boss so proposals.ts stays test-friendly. Wired in
 * `modules/changes/module.ts::init`.
 */
export interface ChangeTriageScheduler {
  publish(name: string, payload: LearningTriageJobPayload): Promise<void>
}

/** History-listing filter — `status: 'all'` or undefined includes every decided variant. */
export interface ListHistoryOptions {
  resourceModule?: string
  status?: ChangeStatus | 'all'
  limit?: number
}

/** Same join shape as the inbox — UI needs the conversation→contact pill. */
export interface ChangeProposalHistoryItem extends ChangeProposalRow {
  conversationContactId: string | null
}

const DECIDED_STATUSES: ChangeStatus[] = ['approved', 'rejected', 'auto_written', 'superseded']

// ─── Materializer registry ───────────────────────────────────────────────────

export interface MaterializeResult {
  resultId: string
  before: unknown
  after: unknown
}

export type Materializer = (proposal: ChangeProposalRow, tx: TxLike) => Promise<MaterializeResult>

export interface MaterializerRegistration {
  resourceModule: string
  resourceType: string
  /**
   * Resource-level sensitivity. Combined with the agent's `confidence` to
   * decide whether `insertProposal` writes `'auto_written'`, `'pending'`, or
   * drops the proposal as trivial. See `./sensitivity.ts::routeStatus`.
   */
  sensitivity: Sensitivity
  /**
   * Optional per-scalar overrides for `field_set` payloads. Resolved against
   * the top-level keys of `payload.fields`; `attributes.<key>` paths are
   * resolved separately via `resolveAttributeSensitivities`. The most
   * restrictive of (resource, scalar overrides, attribute lookups) wins.
   */
  sensitivityForFields?: Record<string, Sensitivity>
  /**
   * Short prose describing this resource for the cheap-model triage prompt
   * (slice 2). Lives at the registration site so adding a learnable resource
   * is a single edit.
   */
  promptHint: string
  /**
   * Optional per-tenant attribute resolver for `attributes.<key>` paths in
   * `field_set` payloads. Today only contacts wires one (backed by
   * `contact_attribute_definitions.sensitivity`); other modules omit it and
   * fall back to the resource-level + scalar overrides.
   */
  resolveAttributeSensitivities?: (organizationId: string, keys: readonly string[]) => Promise<Sensitivity[]>
  materialize: Materializer
}

const registry = new Map<string, MaterializerRegistration>()

export function registerChangeMaterializer(reg: MaterializerRegistration): void {
  registry.set(registryKey(reg.resourceModule, reg.resourceType), reg)
}

/** Snapshot of registered scopes — read by the slice-2 triage prompt builder. */
export function listMaterializerRegistrations(): MaterializerRegistration[] {
  return [...registry.values()]
}

/** Test-only — clears the in-process registry between cases. */
export function __resetChangeRegistryForTests(): void {
  registry.clear()
}

function registryKey(m: string, t: string): string {
  return `${m}:${t}`
}

function getRegistration(resourceModule: string, resourceType: string): MaterializerRegistration {
  const reg = registry.get(registryKey(resourceModule, resourceType))
  if (!reg) {
    throw validation(
      { resourceModule, resourceType },
      `change-proposals: no materializer registered for ('${resourceModule}','${resourceType}')`,
    )
  }
  return reg
}

// Loose drizzle handle shape — keeps tests lightweight without dragging in
// the full ScopedDb generic and its drizzle expression types.
interface DrizzleHandle {
  insert: (t: unknown) => {
    values: (v: unknown) => {
      returning: () => Promise<Array<Record<string, unknown>>>
    }
  }
  update: (t: unknown) => {
    set: (v: unknown) => {
      where: (c: unknown) => Promise<unknown>
    }
  }
  select: (cols?: unknown) => {
    from: (t: unknown) => {
      where: (c: unknown) => {
        limit: (n: number) => Promise<Array<Record<string, unknown>>>
        orderBy: (col: unknown) => {
          limit: (n: number) => Promise<Array<Record<string, unknown>>>
        } & Promise<Array<Record<string, unknown>>>
      } & Promise<Array<Record<string, unknown>>>
      orderBy: (col: unknown) => {
        limit: (n: number) => Promise<Array<Record<string, unknown>>>
      }
    }
  }
  execute: (q: unknown) => Promise<unknown>
  transaction: <T>(fn: (tx: DrizzleHandle) => Promise<T>) => Promise<T>
}

export type TxLike = DrizzleHandle

// ─── Inputs ──────────────────────────────────────────────────────────────────

/**
 * Status is derived from `confidence` × resolved sensitivity at the
 * registration site (see `./sensitivity.ts::routeStatus`). The input shape
 * deliberately omits `status` so callers cannot bypass routing. A `'drop'`
 * outcome surfaces as `TrivialProposalError` rather than a row insertion.
 */
export interface InsertProposalInput {
  organizationId: string
  resourceModule: string
  resourceType: string
  resourceId: string
  payload: ChangePayload
  changedBy: string
  changedByKind: ChangedByKind
  confidence?: number
  /** Free-prose problem statement written by the proposer. Rendered as the "Problem" panel on /changes. */
  rationale?: string
  /** Free-prose "what changes after approval" written by the proposer. Rendered as the "After approval" panel on /changes. */
  expectedOutcome?: string
  /** Non-null when the proposal originates from an agent wake — drives the journal-emission branch. */
  conversationId?: string | null
}

export interface RecordChangeInput {
  organizationId: string
  resourceModule: string
  resourceType: string
  resourceId: string
  payload: ChangePayload
  before: unknown
  after: unknown
  changedBy: string
  changedByKind: ChangedByKind
  appliedProposalId?: string | null
}

export interface DecideResult {
  id: string
  status: 'approved' | 'rejected'
  appliedHistoryId: string | null
}

// biome-ignore lint/suspicious/useAwait: contract requires async signature
async function runThreatScan(_payload: ChangePayload): Promise<{ ok: true } | { ok: false; reason: string }> {
  return { ok: true }
}

/**
 * Coerce a `changedBy` value to the canonical `agent:<id>` / `staff:<id>` form
 * the frontend `<Principal>` directory expects. Drive's CLI already prefixes
 * (`agent:${ctx.agentId}`); contacts' CLI passes a bare user id. We tolerate
 * both and normalize here so downstream consumers (DB, UI) see one shape.
 */
function normalizePrincipalToken(id: string, kind: ChangedByKind): string {
  if (id.includes(':')) return id
  return `${kind === 'agent' ? 'agent' : 'staff'}:${id}`
}

/**
 * Discriminated-union return shape for `insertProposal`. Trivial-confidence
 * inputs surface as `{ status: 'dropped' }` rather than thrown errors so
 * every caller is forced to handle the case at the type level — no silent
 * exceptions, no try/catch boilerplate. Callers that want strict-throw
 * semantics can wrap with `assertProposalLanded(...)` (not provided — there
 * is no current consumer).
 */
export type InsertProposalResult =
  | { status: 'auto_written' | 'pending'; id: string }
  | { status: 'dropped'; confidence: number }

/** Narrow a payload to `markdown_patch` or throw — shared by markdown-only materializers. */
export function assertMarkdownPatch(payload: ChangePayload): Extract<ChangePayload, { kind: 'markdown_patch' }> {
  if (payload.kind !== 'markdown_patch') {
    throw validation({ kind: payload.kind }, `expected markdown_patch payload, got '${payload.kind}'`)
  }
  return payload
}

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * Bridge to the change_decided wake job. Producer for the
 * `changes:decided-to-wake` queue. Owned by the wake module — `module.ts`
 * wires this in at boot using `ctx.jobs.send`. See
 * `wake/change-decided.ts::createChangeDecidedWakeHandler` for the consumer.
 *
 * Only enqueues for real conversations (not synthetic standalone ids); the
 * caller filters before invoking. Fail-soft: an enqueue error is logged but
 * never blocks the staff decision response.
 */
export interface ChangeDecidedScheduler {
  enqueueChangeDecided(opts: {
    organizationId: string
    conversationId: string
    proposalId: string
    decision: 'approved' | 'rejected'
    resourceModule: string
    resourceType: string
    resourceId: string
    summary: string | null
    decidedNote: string | null
    decidedBy: string
  }): Promise<void>
}

export interface ChangeProposalsServiceDeps {
  db: unknown
  realtime?: RealtimeService | null
  /**
   * Optional. When omitted, change-decisions are persisted but no follow-up
   * wake fires (tests can skip plumbing pg-boss; production wires this in
   * via `modules/changes/module.ts::init`).
   */
  decidedScheduler?: ChangeDecidedScheduler | null
  /**
   * Optional learning-triage scheduler. When provided, agent-authored proposals
   * that are rejected emit a `rejection` signal (non-fatal, fire-and-forget).
   */
  triageScheduler?: ChangeTriageScheduler | null
}

export interface ChangeProposalsService {
  insertProposal(input: InsertProposalInput): Promise<InsertProposalResult>
  decideChangeProposal(
    id: string,
    decision: 'approved' | 'rejected',
    decidedByUserId: string,
    note?: string,
  ): Promise<DecideResult>
  listInbox(organizationId: string, limit?: number): Promise<ChangeProposalInboxItem[]>
  listDecided(organizationId: string, opts?: ListHistoryOptions): Promise<ChangeProposalHistoryItem[]>
  recordChange(input: RecordChangeInput): Promise<{ id: string }>
  setRealtime(handle: RealtimeService | null): void
}

export function createChangeProposalsService(deps: ChangeProposalsServiceDeps): ChangeProposalsService {
  const db = deps.db as DrizzleHandle
  let realtime: RealtimeService | null = deps.realtime ?? null
  const decidedScheduler: ChangeDecidedScheduler | null = deps.decidedScheduler ?? null
  const triageScheduler: ChangeTriageScheduler | null = deps.triageScheduler ?? null

  /** Synthetic conversation ids (operator-..., heartbeat-...) belong to the
   *  standalone lane and have no customer to acknowledge — skip the wake. */
  function isCustomerConversationId(id: string | null): id is string {
    if (!id) return false
    if (id.startsWith('operator-') || id.startsWith('heartbeat-')) return false
    return true
  }

  async function fireChangeDecidedWake(
    proposal: ChangeProposalRow,
    decision: 'approved' | 'rejected',
    decidedByUserId: string,
    decidedNote: string | null,
  ): Promise<void> {
    if (!decidedScheduler) return
    if (!isCustomerConversationId(proposal.conversationId)) return
    try {
      await decidedScheduler.enqueueChangeDecided({
        organizationId: proposal.organizationId,
        conversationId: proposal.conversationId,
        proposalId: proposal.id,
        decision,
        resourceModule: proposal.resourceModule,
        resourceType: proposal.resourceType,
        resourceId: proposal.resourceId,
        summary: proposal.rationale,
        decidedNote,
        decidedBy: decidedByUserId,
      })
    } catch (err) {
      console.error('[changes/proposals] enqueueChangeDecided failed (proposal still decided):', err)
    }
  }

  /**
   * Fire-and-forget `rejection` signal to learning:triage. Only emitted when:
   *   - A triage scheduler is wired
   *   - The proposal was authored by an agent (`proposedByKind === 'agent'`)
   *   - The proposal has a `conversationId` (standalone proposals are not observable)
   */
  function fireRejectionTriage(proposal: ChangeProposalRow): void {
    if (!triageScheduler) return
    if (proposal.proposedByKind !== 'agent') return
    // Skip synthetic conversationIds (operator-/heartbeat-) — those don't have a
    // customer-facing thread, and the side-load contributor would silently drop
    // any candidate written against them. Don't burn a gpt_mini call.
    if (!isCustomerConversationId(proposal.conversationId)) return
    const rawProposedBy = proposal.proposedById ?? ''
    const agentId = rawProposedBy.startsWith('agent:') ? rawProposedBy.slice('agent:'.length) : rawProposedBy
    if (!agentId) return
    void triageScheduler
      .publish(LEARNING_TRIAGE_JOB, {
        organizationId: proposal.organizationId,
        agentId,
        conversationId: proposal.conversationId,
        signal: { kind: 'rejection', proposalId: proposal.id, body: proposal.rationale ?? proposal.decidedNote ?? '' },
      })
      .catch((err) => {
        console.warn('[changes/proposals] triage enqueue failed (rejection):', err)
      })
  }

  function fireNotify(
    p: Pick<ChangeProposalRow, 'id' | 'resourceModule' | 'resourceType' | 'resourceId' | 'conversationId'>,
    action: 'created' | 'auto_written' | 'approved' | 'rejected',
  ): void {
    if (!realtime) return
    try {
      realtime.notify({
        table: 'change_proposals',
        id: p.id,
        action,
        resourceModule: p.resourceModule,
        resourceType: p.resourceType,
        resourceId: p.resourceId,
        conversationId: p.conversationId,
      })
    } catch {
      // notify is best-effort — never fail the decide path on a NOTIFY error
    }
  }

  function buildProposalRow(input: InsertProposalInput, id: string, status: ChangeStatus): ChangeProposalRow {
    return {
      id,
      organizationId: input.organizationId,
      resourceModule: input.resourceModule,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      payload: input.payload,
      status,
      confidence: input.confidence ?? null,
      rationale: input.rationale ?? null,
      expectedOutcome: input.expectedOutcome ?? null,
      conversationId: input.conversationId ?? null,
      proposedById: normalizePrincipalToken(input.changedBy, input.changedByKind),
      proposedByKind: input.changedByKind,
      decidedByUserId: null,
      decidedAt: null,
      decidedNote: null,
      appliedHistoryId: null,
      createdAt: new Date(),
    }
  }

  async function findPendingDuplicate(input: InsertProposalInput): Promise<{ id: string } | null> {
    // Generic `db` here resolves `select({...})` to `Record<string, unknown>[]`,
    // so we cast back to the projected shape — same pattern as the other
    // queries in this file (e.g. `as unknown as ChangeProposalRow[]`).
    const rows = (await db
      .select({ id: changeProposals.id })
      .from(changeProposals)
      .where(
        and(
          eq(changeProposals.organizationId, input.organizationId),
          eq(changeProposals.resourceModule, input.resourceModule),
          eq(changeProposals.resourceType, input.resourceType),
          eq(changeProposals.resourceId, input.resourceId),
          eq(changeProposals.status, 'pending'),
        ),
      )
      .limit(1)) as unknown as { id: string }[]
    return rows[0] ?? null
  }

  async function insertProposal(input: InsertProposalInput): Promise<InsertProposalResult> {
    const reg = getRegistration(input.resourceModule, input.resourceType)
    // Sensitivity-driven routing. The agent supplies `confidence`; manual /
    // CLI callers without a confidence default to `1.0` (always-auto-or-pending
    // depending on resource sensitivity — never accidentally drop). The
    // effective sensitivity may escalate beyond the resource default if the
    // payload touches a flagged scalar or a tenant attribute marked sensitive.
    const confidence = input.confidence ?? 1.0
    const sLevel = await effectiveSensitivity({
      resourceSensitivity: reg.sensitivity,
      sensitivityForFields: reg.sensitivityForFields,
      payload: input.payload,
      organizationId: input.organizationId,
      resolveAttributeSensitivities: reg.resolveAttributeSensitivities,
    })
    const route = routeStatus(confidence, sLevel)
    if (route === 'drop') {
      return { status: 'dropped', confidence }
    }
    const status: ChangeStatus = route === 'auto_written' ? 'auto_written' : 'pending'
    // Pending rows compete for the partial unique index; auto-writes materialize
    // immediately and never collide, so the duplicate check only applies to pending.
    if (status === 'pending') {
      const dup = await findPendingDuplicate(input)
      if (dup) {
        // Per-resource (not per-field): matches the partial unique index on
        // `change_proposals`. Typed `details.reason` is read by `isPendingConflict`.
        throw new VobaseError(
          `change-proposals: ${input.resourceModule}/${input.resourceType}/${input.resourceId} already has a pending proposal (id=${dup.id})`,
          'CONFLICT',
          409,
          {
            reason: 'pending_conflict',
            existingProposalId: dup.id,
            resourceModule: input.resourceModule,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
          },
        )
      }
    }
    const id = nanoid(10)
    const proposal = buildProposalRow(input, id, status)

    if (status === 'pending') {
      await db.transaction(async (tx) => {
        await tx.insert(changeProposals).values(proposal).returning()
        await emitLifecycleIfConversation(tx, proposal, {
          type: 'change.proposed',
          rationale: input.rationale ?? null,
          proposedBy: normalizePrincipalToken(input.changedBy, input.changedByKind),
        })
      })
      fireNotify(proposal, 'created')
      return { id, status }
    }

    // route='auto_written' — atomically insert + materialize + record history.
    await db.transaction(async (tx) => {
      await tx.insert(changeProposals).values(proposal).returning()
      const result = await reg.materialize(proposal, tx)
      const historyId = await writeHistoryRow(tx, {
        organizationId: input.organizationId,
        resourceModule: input.resourceModule,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        payload: input.payload,
        before: result.before,
        after: result.after,
        changedBy: input.changedBy,
        changedByKind: input.changedByKind,
        appliedProposalId: id,
      })
      await tx.update(changeProposals).set({ appliedHistoryId: historyId }).where(eq(changeProposals.id, id))
      await emitLifecycleIfConversation(tx, proposal, {
        type: 'change.auto_applied',
        rationale: input.rationale ?? null,
        proposedBy: normalizePrincipalToken(input.changedBy, input.changedByKind),
      })
    })

    fireNotify(proposal, 'auto_written')
    return { id, status }
  }

  async function decideChangeProposal(
    id: string,
    decision: 'approved' | 'rejected',
    decidedByUserId: string,
    note?: string,
  ): Promise<DecideResult> {
    // Status guard runs against the same row read inside the rejection/approval
    // tx below. Threat-scan is async and intentionally outside the tx so a future
    // real scanner doesn't hold a row lock for its duration.
    const result = await db.transaction(async (tx) => {
      const proposal = await loadProposal(tx, id)
      if (!proposal) throw notFound(`change-proposals: not found: ${id}`)
      if (proposal.status !== 'pending') {
        throw conflict(`change-proposals: not pending (status=${proposal.status})`)
      }
      return proposal
    })

    if (decision === 'rejected') {
      const reason = note ?? 'staff_rejected'
      await applyRejection(id, result, decidedByUserId, reason)
      fireNotify(result, 'rejected')
      fireRejectionTriage(result)
      // Only surface staff-authored notes to the customer-facing wake. The
      // synthetic `staff_rejected` reason is just the absence of a note;
      // suppress so the agent doesn't quote it.
      const surfaceNote = note?.trim() ? note.trim() : null
      await fireChangeDecidedWake(result, 'rejected', decidedByUserId, surfaceNote)
      return { id, status: 'rejected', appliedHistoryId: null }
    }

    const scan = await runThreatScan(result.payload)
    if (!scan.ok) {
      await applyRejection(id, result, decidedByUserId, 'threat_scan')
      fireNotify(result, 'rejected')
      fireRejectionTriage(result)
      // Threat-scan rejections never carry a staff note; the wake renderer
      // will fall back to a generic "we couldn't apply that" reply.
      await fireChangeDecidedWake(result, 'rejected', decidedByUserId, null)
      return { id, status: 'rejected', appliedHistoryId: null }
    }

    const reg = getRegistration(result.resourceModule, result.resourceType)
    const historyId = await db.transaction(async (tx) => {
      const materialized = await reg.materialize(result, tx)
      const changedByKind: ChangedByKind = result.conversationId ? 'agent' : 'user'
      const hid = await writeHistoryRow(tx, {
        organizationId: result.organizationId,
        resourceModule: result.resourceModule,
        resourceType: result.resourceType,
        resourceId: result.resourceId,
        payload: result.payload,
        before: materialized.before,
        after: materialized.after,
        changedBy: decidedByUserId,
        changedByKind,
        appliedProposalId: id,
      })
      await tx
        .update(changeProposals)
        .set({
          status: 'approved',
          decidedByUserId,
          decidedAt: new Date(),
          decidedNote: note ?? null,
          appliedHistoryId: hid,
        })
        .where(eq(changeProposals.id, id))
      await emitLifecycleIfConversation(tx, result, {
        type: 'change.approved',
        rationale: result.rationale,
        decidedBy: decidedByUserId,
        decidedNote: note ?? null,
      })
      return hid
    })

    fireNotify(result, 'approved')
    await fireChangeDecidedWake(result, 'approved', decidedByUserId, note?.trim() ? note.trim() : null)
    return { id, status: 'approved', appliedHistoryId: historyId }
  }

  async function applyRejection(
    id: string,
    proposal: ChangeProposalRow,
    decidedByUserId: string,
    reason: string,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .update(changeProposals)
        .set({
          status: 'rejected',
          decidedByUserId,
          decidedAt: new Date(),
          decidedNote: reason,
        })
        .where(eq(changeProposals.id, id))
      await emitLifecycleIfConversation(tx, proposal, {
        type: 'change.rejected',
        rationale: proposal.rationale,
        decidedBy: decidedByUserId,
        decidedNote: reason,
      })
    })
  }

  async function listInbox(organizationId: string, limit = 100): Promise<ChangeProposalInboxItem[]> {
    const rows = (await db
      .select()
      .from(changeProposals)
      .where(and(eq(changeProposals.organizationId, organizationId), eq(changeProposals.status, 'pending')))
      .orderBy(desc(changeProposals.createdAt))
      .limit(limit)) as unknown as ChangeProposalRow[]

    // Resolve conversationId → contactId in a single follow-up read so the UI
    // can render a clickable contact pill without a per-row round-trip.
    // Cross-pgSchema join would be cleaner but the loose DrizzleHandle type
    // here doesn't surface `.leftJoin()` — two reads is the cheaper escape.
    const conversationIds = Array.from(
      new Set(rows.map((r) => r.conversationId).filter((id): id is string => Boolean(id))),
    )
    const contactByConvId = new Map<string, string>()
    if (conversationIds.length > 0) {
      const convRows = (await db
        .select()
        .from(conversations)
        .where(inArray(conversations.id, conversationIds))) as Array<{ id: string; contactId: string }>
      for (const cv of convRows) contactByConvId.set(cv.id, cv.contactId)
    }

    return rows.map((row) => ({
      ...row,
      conversationContactId: row.conversationId ? (contactByConvId.get(row.conversationId) ?? null) : null,
    }))
  }

  async function listDecided(
    organizationId: string,
    opts: ListHistoryOptions = {},
  ): Promise<ChangeProposalHistoryItem[]> {
    const limit = opts.limit ?? 100
    const wantedStatuses = opts.status && opts.status !== 'all' ? [opts.status] : DECIDED_STATUSES

    const conds = [eq(changeProposals.organizationId, organizationId), inArray(changeProposals.status, wantedStatuses)]
    if (opts.resourceModule) conds.push(eq(changeProposals.resourceModule, opts.resourceModule))

    const rows = (await db
      .select()
      .from(changeProposals)
      .where(and(...conds))
      .orderBy(desc(sql`COALESCE(${changeProposals.decidedAt}, ${changeProposals.createdAt})`))
      .limit(limit)) as unknown as ChangeProposalRow[]

    const conversationIds = Array.from(
      new Set(rows.map((r) => r.conversationId).filter((id): id is string => Boolean(id))),
    )
    const contactByConvId = new Map<string, string>()
    if (conversationIds.length > 0) {
      const convRows = (await db
        .select()
        .from(conversations)
        .where(inArray(conversations.id, conversationIds))) as Array<{ id: string; contactId: string }>
      for (const cv of convRows) contactByConvId.set(cv.id, cv.contactId)
    }

    return rows.map((row) => ({
      ...row,
      conversationContactId: row.conversationId ? (contactByConvId.get(row.conversationId) ?? null) : null,
    }))
  }

  return {
    insertProposal,
    decideChangeProposal,
    listInbox,
    listDecided,
    async recordChange(input: RecordChangeInput): Promise<{ id: string }> {
      const id = await writeHistoryRow(db, input)
      return { id }
    },
    setRealtime(handle) {
      realtime = handle
    },
  }
}

// ─── Internal helpers (closure over schema; tx-aware) ────────────────────────

async function loadProposal(handle: DrizzleHandle, id: string): Promise<ChangeProposalRow | null> {
  const rows = (await handle
    .select()
    .from(changeProposals)
    .where(eq(changeProposals.id, id))
    .limit(1)) as unknown as ChangeProposalRow[]
  return rows[0] ?? null
}

async function writeHistoryRow(handle: DrizzleHandle, input: RecordChangeInput): Promise<string> {
  const id = nanoid(10)
  await handle
    .insert(changeHistory)
    .values({
      id,
      organizationId: input.organizationId,
      resourceModule: input.resourceModule,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      payload: input.payload,
      before: input.before ?? null,
      after: input.after ?? null,
      changedBy: input.changedBy,
      changedByKind: input.changedByKind,
      appliedProposalId: input.appliedProposalId ?? null,
    })
    .returning()
  return id
}

/**
 * Dotted-name lifecycle events that land in `harness.conversation_events` and
 * surface to the inbox timeline (see `TIMELINE_ACTIVITY_TYPES` in
 * `modules/messaging/service/conversations.ts`). Producer = this file.
 *
 * Payload mirrors the proposal row's identifying fields plus the SME-friendly
 * `rationale` so the timeline renderer can show a one-liner without a second
 * fetch.
 */
/**
 * Per-call-site specifics for {@link emitLifecycleIfConversation}. The shared
 * fields (`proposalId`, `kind`, `resource*`, `summary`) are derived from the
 * `proposal` row so call sites stay terse and can't drift out of sync with
 * the row's identity.
 */
type LifecycleVariant =
  | { type: 'change.proposed'; rationale: string | null; proposedBy: string }
  | { type: 'change.auto_applied'; rationale: string | null; proposedBy: string }
  | { type: 'change.approved'; rationale: string | null; decidedBy: string; decidedNote: string | null }
  | { type: 'change.rejected'; rationale: string | null; decidedBy: string; decidedNote: string | null }

async function emitLifecycleIfConversation(
  handle: DrizzleHandle,
  proposal: ChangeProposalRow,
  variant: LifecycleVariant,
): Promise<void> {
  if (!proposal.conversationId) return
  // Best-effort: the journal write is a side effect for the inbox timeline,
  // not a correctness-critical step. If the journal service isn't installed
  // (unit tests that bypass `runtime/bootstrap.ts`) we swallow rather than
  // roll back the change-proposal transaction.
  try {
    const turnIndex = await getLatestTurnIndex(proposal.conversationId, handle)
    const wakeId = `change_lifecycle:${proposal.id}`
    const event = {
      ts: new Date(),
      wakeId,
      conversationId: proposal.conversationId,
      organizationId: proposal.organizationId,
      turnIndex,
      proposalId: proposal.id,
      kind: proposal.payload.kind,
      resourceModule: proposal.resourceModule,
      resourceType: proposal.resourceType,
      resourceId: proposal.resourceId,
      summary: summarizeLifecycleEvent({
        payload: proposal.payload,
        resourceModule: proposal.resourceModule,
        resourceType: proposal.resourceType,
      }),
      ...variant,
    }
    await appendJournalEvent(
      {
        conversationId: proposal.conversationId,
        organizationId: proposal.organizationId,
        wakeId,
        turnIndex,
        event: event as unknown as AgentEvent,
      },
      handle,
    )
  } catch (err) {
    console.warn(
      '[changes/proposals] lifecycle journal write skipped (journal service not installed?):',
      err instanceof Error ? err.message : err,
    )
  }
}

// ─── Module-scoped install + port-shim free functions ────────────────────────

let _service: ChangeProposalsService | null = null

export function installChangeProposalsService(svc: ChangeProposalsService): void {
  _service = svc
}

export function __resetChangeProposalsServiceForTests(): void {
  _service = null
}

function current(): ChangeProposalsService {
  if (!_service) {
    throw new Error('changes/proposals: service not installed — call installChangeProposalsService() in module init')
  }
  return _service
}

export function insertProposal(input: InsertProposalInput): Promise<InsertProposalResult> {
  return current().insertProposal(input)
}

export function decideChangeProposal(
  id: string,
  decision: 'approved' | 'rejected',
  decidedByUserId: string,
  note?: string,
): Promise<DecideResult> {
  return current().decideChangeProposal(id, decision, decidedByUserId, note)
}

export function listInbox(organizationId: string, limit?: number): Promise<ChangeProposalInboxItem[]> {
  return current().listInbox(organizationId, limit)
}

export function listDecided(organizationId: string, opts?: ListHistoryOptions): Promise<ChangeProposalHistoryItem[]> {
  return current().listDecided(organizationId, opts)
}

/** Sanctioned write path into `change_history`. `check:shape` blocks any other path. */
export function recordChange(input: RecordChangeInput): Promise<{ id: string }> {
  return current().recordChange(input)
}

export type { ChangeHistoryRow, ChangeProposalRow }

export interface PendingConflictDetails {
  reason: 'pending_conflict'
  existingProposalId: string
  resourceModule: string
  resourceType: string
  resourceId: string
}

export function isPendingConflict(err: unknown): err is VobaseError & { details: PendingConflictDetails } {
  return err instanceof VobaseError && (err.details as { reason?: string } | undefined)?.reason === 'pending_conflict'
}
