/**
 * Placeholder agent ids for system-owned automations.
 *
 * The dispatcher resolves these strings to real wake jobs by lane + event. For
 * the system-cron rules below, the agent ids stay placeholders until an
 * operator wires a real agent — the dispatcher will enqueue
 * `agents:operator-thread-to-wake` jobs that consult the
 * `automation:<rule.id>` thread the rule synthesises.
 *
 * Production deployments can replace any of these with a concrete
 * `agent_definitions(id)` row and the dispatcher will route through that
 * agent's standalone wake.
 */
export const PENDING_DECISION_FOLLOWUP_AGENT_ID = 'agent:pending-decision-followup-system'
export const BUDGET_WATCHER_AGENT_ID = 'agent:budget-watcher-system'
export const PENDING_STAFF_PINGS_PRUNE_AGENT_ID = 'agent:pending-staff-pings-prune-system'

/**
 * Stable rule names + cron expressions for the three system-owned crons.
 * Exported so tests can target the seeded rows by name.
 */
export const PENDING_DECISION_FOLLOWUP_RULE_NAME = 'pending-decision-followup'
export const PENDING_DECISION_FOLLOWUP_CRON = '*/10 * * * *' // every 10 minutes

export const BUDGET_WATCHER_RULE_NAME = 'budget-watcher'
export const BUDGET_WATCHER_CRON = '* * * * *' // every minute

export const PENDING_STAFF_PINGS_PRUNE_RULE_NAME = 'pending-staff-pings-prune'
export const PENDING_STAFF_PINGS_PRUNE_CRON = '*/15 * * * *' // every 15 minutes

/**
 * Rule name for the nightly `automation_runs` retention sweep.
 *
 * The actual DELETE fires from a dedicated pg-boss recurring job
 * (`automations:runs-prune`, see `jobs.ts`); this automations row is
 * documentation + dashboard visibility so operators see retention
 * activity surface in `/automations` alongside the live automations.
 * Agent id comes from `runs-prune.ts` (canonical source).
 */
import { SYSTEM_PRUNE_AGENT_ID } from './service/runs-prune'

export { SYSTEM_PRUNE_AGENT_ID }

export const AUTOMATION_RUNS_PRUNE_RULE_NAME = 'automation-runs-prune'
export const AUTOMATION_RUNS_PRUNE_CRON = '0 3 * * *' // 03:00 UTC nightly

/**
 * Seeds `automations.automations` from `automations.automation_rules`,
 * then seeds the system-owned `pending-decision-followup` cron row.
 *
 * For every cron schedule row, inserts a paired automations row with
 * `eventName='cron'` and `action={type:'wake', agentId, lane:'standalone'}`.
 * Idempotent via ON CONFLICT (organization_id, name) DO NOTHING.
 *
 * Runs after `seedAgents` (which populates `automation_rules`) so the agent
 * FK is always satisfied.
 *
 * The pending-decision-followup row uses a placeholder `agentId` string;
 * US-013's dispatcher resolves it before scheduling a wake.
 */
export async function seedAutomations(db: unknown, opts?: { organizationId?: string }): Promise<void> {
  // biome-ignore lint/plugin/no-dynamic-import: seeds load schema lazily to avoid module-init-order issues (convention across modules/*/seed.ts)
  const { automations, automationRules } = await import('@modules/automations/schema')

  // Using raw drizzle select + insert to build the mirror rows from
  // automation_rules without requiring a raw SQL client in the seed.
  const d = db as {
    select: () => {
      from: (t: unknown) => Promise<
        Array<{
          id: string
          organizationId: string
          agentId: string
          slug: string
          cron: string
          enabled: boolean
          createdAt: Date
          updatedAt: Date
        }>
      >
    }
    insert: (t: unknown) => {
      values: (v: unknown) => { onConflictDoNothing: () => Promise<void> }
    }
  }

  const rules = await d.select().from(automationRules)

  for (const rule of rules) {
    await d
      .insert(automations)
      .values({
        id: rule.id, // reuse id so cross-references resolve
        organizationId: rule.organizationId,
        name: rule.slug,
        eventName: 'cron',
        action: { type: 'wake', agentId: rule.agentId, lane: 'standalone' },
        paused: !rule.enabled,
        cron: rule.cron,
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt,
      })
      .onConflictDoNothing()
  }

  // System-owned pending-decision-followup cron (US-010). Seeded once per org
  // we know about; falls back to scanning distinct orgs from automation_rules
  // when no explicit org is provided.
  const orgIds = opts?.organizationId ? [opts.organizationId] : Array.from(new Set(rules.map((r) => r.organizationId)))

  for (const organizationId of orgIds) {
    // pending-decision-followup (US-010)
    await d
      .insert(automations)
      .values({
        organizationId,
        name: PENDING_DECISION_FOLLOWUP_RULE_NAME,
        eventName: 'cron',
        action: {
          type: 'wake',
          agentId: PENDING_DECISION_FOLLOWUP_AGENT_ID,
          lane: 'standalone',
        },
        paused: false,
        cron: PENDING_DECISION_FOLLOWUP_CRON,
      })
      .onConflictDoNothing()

    // budget-watcher (US-013) — placeholder agent id; production deployments
    // can replace with a concrete agent definition. The dispatcher routes
    // through `automation:<rule.id>` operator threads.
    await d
      .insert(automations)
      .values({
        organizationId,
        name: BUDGET_WATCHER_RULE_NAME,
        eventName: 'cron',
        action: {
          type: 'wake',
          agentId: BUDGET_WATCHER_AGENT_ID,
          lane: 'standalone',
        },
        paused: false,
        cron: BUDGET_WATCHER_CRON,
      })
      .onConflictDoNothing()

    // pending-staff-pings-prune (US-007 follow-up) — sweeps soft-deleted
    // `pending_staff_pings` rows that have been claimed long enough to be
    // safely purged. Placeholder agent until a sweeper agent is wired.
    await d
      .insert(automations)
      .values({
        organizationId,
        name: PENDING_STAFF_PINGS_PRUNE_RULE_NAME,
        eventName: 'cron',
        action: {
          type: 'wake',
          agentId: PENDING_STAFF_PINGS_PRUNE_AGENT_ID,
          lane: 'standalone',
        },
        paused: false,
        cron: PENDING_STAFF_PINGS_PRUNE_CRON,
      })
      .onConflictDoNothing()

    // automation-runs-prune (US-015) — dashboard placeholder for the nightly
    // retention sweep. The actual DELETE runs from the pg-boss
    // `automations:runs-prune` job (registered in `module.ts`), independent
    // of the dispatcher — but operators see this row in /automations so
    // the retention behaviour is visible alongside live automations.
    await d
      .insert(automations)
      .values({
        organizationId,
        name: AUTOMATION_RUNS_PRUNE_RULE_NAME,
        eventName: 'cron',
        action: {
          type: 'wake',
          agentId: SYSTEM_PRUNE_AGENT_ID,
          lane: 'standalone',
        },
        paused: false,
        cron: AUTOMATION_RUNS_PRUNE_CRON,
      })
      .onConflictDoNothing()
  }
}
