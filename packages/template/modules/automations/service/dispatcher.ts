/**
 * Sole writer of `automations.automation_runs`.
 *
 * `dispatchAutomationRun(eventName, payload, { tx })` is the body invoked by
 * `events.emit()` after Zod-parsing the payload. For each rule matching the
 * `(eventName, organizationId?)` pair the dispatcher:
 *
 *   1. Inserts an `automation_runs` row with `status='queued'`.
 *   2. If the rule is paused → updates the row to `status='suppressed_paused'`
 *      and exits.
 *   3. For staff-ping-shaped events (`approval_filed`/`proposal_filed`),
 *      consults the cooldown predicate. Suppressed →
 *      `status='suppressed_cooldown'` + exit.
 *   4. Resolves a `WakeTrigger` from `(rule.action, eventPayload)`, enqueues a
 *      wake via the installed scheduler, updates the row to
 *      `status='succeeded'` + `wake_id=<jobId>` + `finished_at=now()`.
 *
 * On exception: status='failed', error_message=err.message.
 *
 * Note: the run-row INSERT runs through Drizzle's `tx` handle (passed by
 * `emit()`), so a producer rollback also discards the run row.
 */

import type { AutomationRunStatus } from '@modules/automations/schema'
import { automationRuns } from '@modules/automations/schema'
import { automationsService } from '@modules/automations/service/automations'
import { shouldSuppress } from '@modules/automations/service/cooldown'
import type { EventName, EventPayload } from '@modules/automations/service/registry'
import type { ScopedScheduler } from '@vobase/core'
import { eq } from 'drizzle-orm'

import { type RealtimeService, type ScopedDb, safeNotify, type Tx } from '~/runtime'

export interface DispatchResult {
  runId: string
  status: AutomationRunStatus
}

export interface DispatcherDeps {
  /** Used for the run-row UPDATEs that happen AFTER the producer's tx commits. */
  db: ScopedDb
  /** In-process or pg-boss scheduler — receives the wake-enqueue. */
  jobs: ScopedScheduler
  /**
   * Optional realtime handle — when provided, every dispatch emits a
   * `pg_notify` on the `automation_runs` table so the `/system/activity`
   * RecentRunsTable streams live without polling.
   */
  realtime?: RealtimeService
}

let _deps: DispatcherDeps | null = null

export function installDispatcher(deps: DispatcherDeps): void {
  _deps = deps
}

export function __resetDispatcherForTests(): void {
  _deps = null
}

function getDeps(): DispatcherDeps {
  if (!_deps) throw new Error('dispatcher: deps not installed (call installDispatcher at boot)')
  return _deps
}

/**
 * Entry point wired to `events.setDispatcher()`. Receives the event AFTER Zod
 * validation; iterates matching rules; one run-row per rule per event.
 */
export async function dispatchEvent<E extends EventName>(
  eventName: E,
  payload: EventPayload<E>,
  ctx: { tx: Tx },
): Promise<DispatchResult[]> {
  // The org filter is derived from the payload when present — `cron` events
  // carry no org, so they fan out across all tenants' matching rules.
  const orgId = (payload as { organizationId?: string }).organizationId
  const rules = await automationsService.listRulesForEvent(eventName, orgId)
  const results: DispatchResult[] = []
  for (const rule of rules) {
    const r = await dispatchAutomationRun({ ruleId: rule.id, eventName, payload, ctx, rule })
    results.push(r)
  }
  return results
}

interface RuleSnapshot {
  id: string
  organizationId: string
  name: string
  eventName: string
  action: { type: 'wake' | 'webhook'; agentId?: string; lane?: 'conversation' | 'standalone' }
  paused: boolean
  cron: string | null
}

interface DispatchOneArgs<E extends EventName> {
  ruleId: string
  eventName: E
  payload: EventPayload<E>
  ctx: { tx: Tx }
  /** Optional pre-fetched rule row (avoids a second SELECT inside the dispatch hot path). */
  rule?: RuleSnapshot
}

/**
 * Dispatch a SINGLE rule for a SINGLE event. Public for the unit tests + the
 * fan-out helper above. The producer tx is the SAME tx that emit() was called
 * inside; the run-row INSERT lands through `tx` so producer-rollback discards
 * the run too.
 */
export async function dispatchAutomationRun<E extends EventName>(args: DispatchOneArgs<E>): Promise<DispatchResult> {
  const result = await dispatchAutomationRunInner(args)
  // Best-effort post-tx notify so the RecentRunsTable invalidates without
  // polling. Notify *outside* the producer tx — pg_notify deduping makes a
  // double-emit harmless but only the post-commit version is observable to
  // SSE consumers in another connection.
  const deps = getDeps()
  if (deps.realtime) {
    safeNotify(deps.realtime, { table: 'automation_runs', id: result.runId, action: result.status })
  }
  return result
}

async function dispatchAutomationRunInner<E extends EventName>(args: DispatchOneArgs<E>): Promise<DispatchResult> {
  const { ruleId, eventName, payload, ctx } = args
  const deps = getDeps()
  const t = ctx.tx as unknown as ScopedDb
  const startedAt = new Date()

  // Resolve the rule snapshot if not pre-fetched.
  const rule = args.rule ?? (await loadRuleViaTx(t, ruleId))
  if (!rule) {
    // The rule disappeared between listing and dispatch — defensive guard.
    // Insert a `failed` row so the operator dashboard reflects the loss.
    const runId = await insertRunRow(t, {
      ruleId,
      organizationId: '<unknown>',
      eventName,
      status: 'failed',
      startedAt,
      errorMessage: 'rule not found at dispatch',
      payload,
    })
    return { runId, status: 'failed' }
  }

  // 1. Insert queued row.
  const runId = await insertRunRow(t, {
    ruleId: rule.id,
    organizationId: rule.organizationId,
    eventName,
    status: 'queued',
    startedAt,
    payload,
  })

  // 2. Paused rule → suppressed_paused.
  if (rule.paused) {
    await finishRun(t, runId, 'suppressed_paused', startedAt)
    return { runId, status: 'suppressed_paused' }
  }

  // 3. Cooldown for staff-ping-shaped events. We currently only inspect the two
  //    shapes that produce per-conversation pings; cron/approval_decided/etc.
  //    bypass cooldown.
  if (eventName === 'approval_filed' || eventName === 'proposal_filed') {
    const p = payload as unknown as {
      conversationId: string | null
      organizationId: string
      assigneeStaffUserId?: string | null
      proposedByAgentId?: string
      filedByAgentId?: string
    }
    if (p.conversationId && p.assigneeStaffUserId) {
      const suppressed = await shouldSuppress({
        staffUserId: p.assigneeStaffUserId,
        conversationId: p.conversationId,
        organizationId: p.organizationId,
        kind: eventName === 'approval_filed' ? 'approval' : 'proposal',
      })
      if (suppressed) {
        await finishRun(t, runId, 'suppressed_cooldown', startedAt)
        return { runId, status: 'suppressed_cooldown' }
      }
    }
  }

  // 4. Resolve wake target + enqueue. Scheduler send is post-tx (the in-process
  //    queue is fire-and-forget and not transactional). On exception we mark
  //    the run failed.
  try {
    const triggerSpec = buildWakeTrigger(rule, eventName, payload)
    if (!triggerSpec) {
      await finishRun(
        t,
        runId,
        'failed',
        startedAt,
        `no trigger mapping for event '${eventName}' / action.type='${rule.action.type}'`,
      )
      return { runId, status: 'failed' }
    }
    const jobId = await deps.jobs.send(triggerSpec.jobName, triggerSpec.jobPayload, triggerSpec.opts)
    await finishRunSucceeded(t, runId, startedAt, jobId)
    return { runId, status: 'succeeded' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await finishRun(t, runId, 'failed', startedAt, message)
    return { runId, status: 'failed' }
  }
}

// ─── Internal helpers ──────────────────────────────────────────────────────

async function loadRuleViaTx(_t: ScopedDb, ruleId: string): Promise<RuleSnapshot | undefined> {
  // We use the public service for cache consistency, even though this would
  // run outside the tx; the rule snapshot is read-only here so cross-tx read
  // is fine.
  const row = await automationsService.getRuleById(ruleId)
  if (!row) return undefined
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    eventName: row.eventName,
    action: row.action,
    paused: row.paused,
    cron: row.cron,
  }
}

interface InsertRunArgs {
  ruleId: string
  organizationId: string
  eventName: string
  status: AutomationRunStatus
  startedAt: Date
  errorMessage?: string
  payload: unknown
}

async function insertRunRow(t: ScopedDb, args: InsertRunArgs): Promise<string> {
  const inserted = await t
    .insert(automationRuns)
    .values({
      ruleId: args.ruleId,
      organizationId: args.organizationId,
      eventName: args.eventName,
      status: args.status,
      startedAt: args.startedAt,
      errorMessage: args.errorMessage ?? null,
      payloadSnapshot: args.payload as object,
    })
    .returning({ id: automationRuns.id })
  const id = inserted[0]?.id
  if (!id) throw new Error('dispatcher: insertRunRow returned no row')
  return id
}

async function finishRun(
  t: ScopedDb,
  runId: string,
  status: AutomationRunStatus,
  startedAt: Date,
  errorMessage?: string,
): Promise<void> {
  const finishedAt = new Date()
  await t
    .update(automationRuns)
    .set({
      status,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      errorMessage: errorMessage ?? null,
    })
    .where(eq(automationRuns.id, runId))
}

async function finishRunSucceeded(t: ScopedDb, runId: string, startedAt: Date, wakeId: string): Promise<void> {
  const finishedAt = new Date()
  await t
    .update(automationRuns)
    .set({
      status: 'succeeded',
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      wakeId,
    })
    .where(eq(automationRuns.id, runId))
}

// ─── Wake-trigger routing ─────────────────────────────────────────────────

interface WakeJobSpec {
  jobName: string
  jobPayload: unknown
  opts?: { singletonKey?: string }
}

/**
 * Map (rule.action, eventPayload) → (jobName, jobPayload) for the wake bus.
 *
 * Conversation-lane events route to `agents:wake`; standalone-lane events to
 * `agents:operator-thread-to-wake` (since standalone wakes today are driven
 * via operator threads — the dispatcher doesn't synthesise a new thread, it
 * just enqueues against the rule's target agent). Returns null when the
 * mapping is unsupported (caller marks the run failed).
 */
function buildWakeTrigger<E extends EventName>(
  rule: RuleSnapshot,
  eventName: E,
  payload: EventPayload<E>,
): WakeJobSpec | null {
  if (rule.action.type !== 'wake') return null
  const agentId = rule.action.agentId
  if (!agentId) return null
  const lane = rule.action.lane ?? 'standalone'

  // Pragmatic v1 routing: we enqueue against the existing wake bus shapes,
  // synthesising the minimal payload the consumer expects. Triggers that need
  // richer routing (conversation_id resolution etc.) carry the data on the
  // event payload; we forward it.

  if (eventName === 'cron') {
    // Heartbeat tick — handled by `wake/heartbeat.ts`'s emitter. We route via
    // the operator-thread bus since there's no conversation context;
    // standalone wakes (the canonical lane for cron triggers) are usually
    // produced by `setHeartbeatEmitter` rather than the dispatcher. For the
    // dispatcher path we enqueue a placeholder job that the wake/heartbeat
    // module already handles. See plan §5 — this is the "system wakes don't
    // get a thread, just fire-and-forget" pragma.
    //
    // Today we enqueue an operator-thread job; in a follow-up the dispatcher
    // could call `getHeartbeatEmitter()` directly and skip the queue.
    return {
      jobName: 'agents:operator-thread-to-wake',
      jobPayload: {
        organizationId: rule.organizationId,
        threadId: `automation:${rule.id}`,
      },
    }
  }

  if (eventName === 'conversation_reassigned') {
    const p = payload as EventPayload<'conversation_reassigned'>
    return {
      jobName: 'agents:wake',
      jobPayload: {
        organizationId: p.organizationId,
        conversationId: p.conversationId,
        contactId: '', // resolved by the wake handler
        trigger: {
          trigger: 'conversation_reassigned' as const,
          conversationId: p.conversationId,
          fromAssignee: p.fromAssignee,
          toAssignee: p.toAssignee,
          reason: p.reason,
        },
      },
      opts: { singletonKey: `agents:wake:${p.conversationId}` },
    }
  }

  if (eventName === 'approval_filed') {
    const p = payload as EventPayload<'approval_filed'>
    if (lane === 'conversation' && p.conversationId) {
      return {
        jobName: 'agents:wake',
        jobPayload: {
          organizationId: p.organizationId,
          conversationId: p.conversationId,
          contactId: '',
          trigger: {
            trigger: 'approval_filed' as const,
            conversationId: p.conversationId,
            approvalId: p.approvalId,
            approvalSummary: p.approvalSummary,
            filedByAgentId: p.filedByAgentId,
          },
        },
        opts: { singletonKey: `agents:wake:${p.conversationId}` },
      }
    }
    // standalone lane → operator-thread enqueue against the filing agent
    return {
      jobName: 'agents:operator-thread-to-wake',
      jobPayload: {
        organizationId: p.organizationId,
        threadId: `automation:${rule.id}`,
      },
    }
  }

  if (eventName === 'approval_decided') {
    const p = payload as EventPayload<'approval_decided'>
    if (lane === 'conversation' && p.conversationId) {
      return {
        jobName: 'agents:wake',
        jobPayload: {
          organizationId: p.organizationId,
          conversationId: p.conversationId,
          contactId: '',
          trigger: {
            trigger: 'approval_decided' as const,
            conversationId: p.conversationId,
            approvalId: p.approvalId,
            decision: p.decision,
            decidedByLabel: p.decidedByLabel,
            filedByAgentId: p.filedByAgentId,
            note: p.note,
          },
        },
        opts: { singletonKey: `agents:wake:${p.conversationId}` },
      }
    }
    return {
      jobName: 'agents:operator-thread-to-wake',
      jobPayload: {
        organizationId: p.organizationId,
        threadId: `automation:${rule.id}`,
      },
    }
  }

  if (eventName === 'proposal_filed') {
    const p = payload as EventPayload<'proposal_filed'>
    if (lane === 'conversation' && p.conversationId) {
      return {
        jobName: 'agents:wake',
        jobPayload: {
          organizationId: p.organizationId,
          conversationId: p.conversationId,
          contactId: '',
          trigger: {
            trigger: 'proposal_filed' as const,
            conversationId: p.conversationId,
            proposalId: p.proposalId,
            proposalSummary: p.proposalSummary,
            resourceModule: p.resourceModule,
            resourceType: p.resourceType,
            proposedByAgentId: p.proposedByAgentId,
          },
        },
        opts: { singletonKey: `agents:wake:${p.conversationId}` },
      }
    }
    return {
      jobName: 'agents:operator-thread-to-wake',
      jobPayload: {
        organizationId: p.organizationId,
        threadId: `automation:${rule.id}`,
      },
    }
  }

  if (eventName === 'proposal_decided') {
    const p = payload as EventPayload<'proposal_decided'>
    if (lane === 'conversation' && p.conversationId) {
      return {
        jobName: 'agents:wake',
        jobPayload: {
          organizationId: p.organizationId,
          conversationId: p.conversationId,
          contactId: '',
          trigger: {
            trigger: 'proposal_decided' as const,
            conversationId: p.conversationId,
            proposalId: p.proposalId,
            decision: p.decision,
            proposedByAgentId: p.proposedByAgentId,
            note: p.note,
          },
        },
        opts: { singletonKey: `agents:wake:${p.conversationId}` },
      }
    }
    return {
      jobName: 'agents:operator-thread-to-wake',
      jobPayload: {
        organizationId: p.organizationId,
        threadId: `automation:${rule.id}`,
      },
    }
  }

  return null
}
