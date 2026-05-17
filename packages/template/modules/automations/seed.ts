/**
 * Seeds `automations.automations` from `automations.automation_rules`.
 *
 * For every cron schedule row, inserts a paired automations row with
 * `eventName='cron'` and `action={type:'wake', agentId, lane:'standalone'}`.
 * Idempotent via ON CONFLICT (organization_id, name) DO NOTHING.
 *
 * Runs after `seedAgents` (which populates `automation_rules`) so the agent
 * FK is always satisfied.
 */
export async function seedAutomations(db: unknown): Promise<void> {
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
}
