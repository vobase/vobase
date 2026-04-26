/**
 * Shared building blocks every wake-config flavour assembles. Pure helpers
 * + constants — no per-wake state. Concierge (`./concierge.ts`) and operator
 * (`./operator.ts`) flavours both consume these.
 *
 * Frozen-snapshot invariant: anything that lands in `systemPrompt` is computed
 * exactly once per wake. Mid-wake writes (memory, drive proposals, file ops)
 * persist immediately but only surface in the NEXT turn's side-load — the
 * provider's prefix cache is byte-keyed on the prompt.
 */

import * as contactsModule from '@modules/contacts/agent'
import { list as listContacts } from '@modules/contacts/service/contacts'
import * as messagingModule from '@modules/messaging/agent'
import type { Conversation } from '@modules/messaging/schema'
import { list as listConversations } from '@modules/messaging/service/conversations'
import * as schedulesModule from '@modules/schedules/agent'
import { schedules as schedulesService } from '@modules/schedules/service/schedules'
import { staff as teamStaff } from '@modules/team/service'
import type { HarnessLogger, WorkspaceMaterializer } from '@vobase/core'
import { IndexFileBuilder } from '@vobase/core'

import type { RealtimeService, ScopedDb } from '~/runtime'

/**
 * Idle-resumption threshold: if the conversation has been quiet longer than
 * this, the side-load injects a `<conversation-idle-resume>` marker so the
 * agent acknowledges the gap instead of assuming conversational recency.
 * 24h matches typical helpdesk "stale thread" semantics.
 */
export const IDLE_RESUMPTION_THRESHOLD_MS = 24 * 60 * 60 * 1000

/** Common per-wake handles passed into both flavours. */
export interface BaseWakeDeps {
  db: ScopedDb
  realtime: RealtimeService
  logger: HarnessLogger
}

/**
 * Return the set of staff userIds materialized under `/staff/<id>/` for this
 * wake — every staff_profiles row in the org. Silent-fails to `[]` when the
 * team service isn't available yet (boot ordering for headless tests).
 */
export async function resolveStaffIdsForOrg(organizationId: string): Promise<readonly string[]> {
  try {
    const profiles = await teamStaff.list(organizationId)
    return profiles.map((p) => p.userId)
  } catch {
    return []
  }
}

/**
 * `/INDEX.md` aggregator. Loads contributors from messaging, schedules, and
 * contacts at materialize-time, registers them with a per-wake builder, and
 * renders the joined document. Empty document → a stable placeholder so the
 * file is always present on the agent's FS.
 *
 * Contributors are pre-baked: each module's loader fetches its data, then
 * returns synchronous `IndexContributor` records that close over it. This
 * keeps `IndexFileBuilder.build()` sync while the materializer itself stays
 * async, matching the existing `WorkspaceMaterializer` shape.
 */
export function buildIndexFileMaterializer(opts: { organizationId: string }): WorkspaceMaterializer {
  return {
    path: '/INDEX.md',
    phase: 'frozen',
    materialize: async () => {
      const conversationsReader = {
        list: (orgId: string, listOpts?: { tab?: 'active' | 'later' | 'done' }): Promise<Conversation[]> =>
          listConversations(orgId, listOpts),
      }
      const [msgContribs, schedContribs, contactContribs] = await Promise.all([
        messagingModule.loadIndexContributors({
          organizationId: opts.organizationId,
          conversations: conversationsReader,
        }),
        schedulesModule.loadIndexContributors({
          organizationId: opts.organizationId,
          schedules: schedulesService,
        }),
        contactsModule.loadIndexContributors({
          organizationId: opts.organizationId,
          contacts: { list: listContacts },
        }),
      ])
      const builder = new IndexFileBuilder().registerAll([...msgContribs, ...schedContribs, ...contactContribs])
      const out = builder.build({ file: 'INDEX.md' })
      return out.length > 0 ? `${out}\n` : '# Index\n\n_No activity yet._\n'
    },
  }
}
