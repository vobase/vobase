/**
 * Within-24h check for WhatsApp free-form routing.
 *
 * WhatsApp's 24-hour customer service window allows free-form messages only
 * when the customer sent an inbound message within the last 24 hours. This
 * helper queries `infra.channels_log` to make that determination.
 *
 * The query uses a **23h50m safety margin** (rather than the full 24h) as a
 * clock-skew + network-latency defense: platform timestamps recorded at the
 * WhatsApp edge may lag our Postgres `now()` by seconds to minutes, and
 * sending a free-form message milliseconds after the true window expiry would
 * result in a delivery failure. Ten minutes of headroom eliminates that
 * failure mode without materially reducing the usable window.
 *
 * Tenant-scoping note: `infra.channels_log` has no `organization_id` column.
 * The table is a shared infrastructure log across all tenants. Tenant
 * isolation relies on E.164 phone numbers being globally unique — a given
 * `staffPhoneE164` maps to exactly one tenant's staff member. The
 * `organizationId` parameter is accepted for interface consistency (callers
 * always carry org context) but is not applied as a DB filter because the
 * column does not exist on the table.
 */

import { channelsLog } from '@vobase/core'
import { and, eq, gte, sql } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'

/**
 * Returns `true` when there is at least one inbound WhatsApp message from
 * `staffPhoneE164` recorded within the last 23 hours and 50 minutes.
 *
 * The 23h50m window is deliberately shorter than the 24h WhatsApp policy
 * window: it provides a safety margin against clock skew between the
 * WhatsApp platform edge and this server's Postgres clock, and against
 * network latency between receiving the check result and delivering the
 * outbound message.
 *
 * @param db - Scoped Drizzle handle for the tenant.
 * @param staffPhoneE164 - E.164-formatted phone number of the staff member
 *   whose inbound message history is being checked.
 * @param organizationId - Organization identifier. Accepted for interface
 *   consistency; not applied as a DB filter because `infra.channels_log`
 *   has no `organization_id` column.
 */
export async function checkWithin24h(db: ScopedDb, staffPhoneE164: string, _organizationId: string): Promise<boolean> {
  const rows = await db
    .select({ id: channelsLog.id })
    .from(channelsLog)
    .where(
      and(
        eq(channelsLog.direction, 'inbound'),
        eq(channelsLog.from, staffPhoneE164),
        eq(channelsLog.channel, 'whatsapp'),
        gte(channelsLog.createdAt, sql`now() - interval '23 hours 50 minutes'`),
      ),
    )
    .limit(1)
  return rows.length > 0
}
