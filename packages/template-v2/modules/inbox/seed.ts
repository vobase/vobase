/**
 * inbox module seed — inserts one conversation row.
 * B2: exports SEEDED_CONV_ID as a stable constant consumed by integration tests.
 *
 * Uses direct insert (ON CONFLICT DO NOTHING) for idempotency with a stable ID.
 * TODO: swap to service.create once it accepts a caller-supplied id field.
 */

import { MERIDIAN_AGENT_ID } from '@modules/agents/seed'
import { CUSTOMER_CHANNEL_INSTANCE_ID, MERIDIAN_TENANT_ID, SEEDED_CONTACT_ID } from '@modules/contacts/seed'

export { MERIDIAN_TENANT_ID, SEEDED_CONTACT_ID }

/** Stable conversation ID — imported by integration tests and Lane F test-harness. */
export const SEEDED_CONV_ID = 'cnv0test00'

export async function seed(db: unknown): Promise<void> {
  const { conversations } = await import('@modules/inbox/schema')

  const d = db as {
    insert: (t: unknown) => {
      values: (v: unknown) => { onConflictDoNothing: () => Promise<void> }
    }
  }

  await d
    .insert(conversations)
    .values({
      id: SEEDED_CONV_ID,
      tenantId: MERIDIAN_TENANT_ID,
      contactId: SEEDED_CONTACT_ID,
      channelInstanceId: CUSTOMER_CHANNEL_INSTANCE_ID,
      status: 'active',
      assignee: `agent:${MERIDIAN_AGENT_ID}`,
    })
    .onConflictDoNothing()
}
