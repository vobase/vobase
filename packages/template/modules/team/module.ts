import { registerChangeMaterializer } from '@modules/changes/service/proposals'
import { registerDriveOverlay } from '@modules/drive/service/overlays'
import { sendNotificationTemplate } from '@modules/integrations/service/handshake'

import type { ModuleDef } from '~/runtime'
import { teamAgent } from './agent'
import { jobs as teamJobs } from './jobs'
import { createStaffAttrDefService, installStaffAttrDefService } from './service/attribute-definitions'
import { STAFF_RESOURCE, staffChangeMaterializer } from './service/changes'
import { staffCrossAgentMemoryOverlay } from './service/drive-overlay'
import { createMentionNotifyService, installMentionNotifyService, type SendTemplateFn } from './service/mention-notify'
import { createMentionsService, installMentionsService } from './service/mentions'
import { createPendingMentionPingService, installPendingMentionPingService } from './service/pending-mention-pings'
import { createStaffService, installStaffService } from './service/staff'
import {
  installTeamJobsState,
  SYNC_STAFF_LINK_CRON,
  SYNC_STAFF_LINK_CRON_JOB,
  SYNC_STAFF_LINK_JOB,
  SYNC_STAFF_LINK_SINGLETON_HOURS,
} from './service/staff-link-sync'
import { installTeamOrgEnumerator } from './service/staff-link-sync-orgs'
import { STAFF_MEMORY_RESOURCE, staffMemoryChangeMaterializer } from './service/staff-memory-changes'
import { createTeamDescriptionService, installTeamDescriptionService } from './service/team-descriptions'
import { teamGetVerb } from './verbs/team-get'
import { teamListVerb } from './verbs/team-list'
import * as web from './web'

const team: ModuleDef = {
  name: 'team',
  requires: ['contacts', 'settings', 'drive', 'agents', 'changes'],
  web: { routes: web.routes },
  jobs: teamJobs,
  agent: teamAgent,
  init(ctx) {
    installStaffService(createStaffService({ db: ctx.db, realtime: ctx.realtime }))
    installStaffAttrDefService(createStaffAttrDefService({ db: ctx.db }))
    installTeamDescriptionService(createTeamDescriptionService({ db: ctx.db }))
    installMentionsService(createMentionsService({ db: ctx.db }))
    // Build the platform-call closure once: env reads happen at boot (not on
    // every send), and tests inject their own `sendTemplate` stub instead of
    // mocking global fetch + env.
    const sendTemplate: SendTemplateFn | undefined = (() => {
      const platformBaseUrl = process.env.VITE_PLATFORM_URL ?? ''
      const tenantId = process.env.PLATFORM_TENANT_ID ?? ''
      const tenantHmacSecret = process.env.PLATFORM_HMAC_SECRET ?? ''
      if (!platformBaseUrl || !tenantId || !tenantHmacSecret) return undefined
      return ({ staffPhoneE164, bodyParams, buttonUrlSuffix }) =>
        sendNotificationTemplate({
          platformBaseUrl,
          tenantId,
          tenantHmacSecret,
          staffPhoneE164,
          bodyParams,
          buttonUrlSuffix,
        })
    })()
    installMentionNotifyService(createMentionNotifyService({ db: ctx.db, jobs: ctx.jobs, sendTemplate }))
    installPendingMentionPingService(createPendingMentionPingService({ db: ctx.db }))
    installTeamJobsState({ jobs: ctx.jobs })
    installTeamOrgEnumerator({ db: ctx.db })
    // Daily cron — `ctx.jobs.schedule?` is optional on the ScopedScheduler
    // contract; the in-process queue used by `bun run dev` does not implement
    // it, so the cron only registers under pg-boss in production / e2e.
    void ctx.jobs.schedule?.(SYNC_STAFF_LINK_CRON_JOB, SYNC_STAFF_LINK_CRON, undefined, {
      // pg-boss rejects duplicate enqueues within the singleton window, so
      // workers racing on a missed tick can't double-fire.
      singletonKey: SYNC_STAFF_LINK_JOB,
    })
    // Surface the singleton window for downstream tooling (audit logs,
    // ops dashboards). 1 minute → ≤5 in-flight reconciles per org per
    // 5-minute window (R9-E rate-limit).
    void SYNC_STAFF_LINK_SINGLETON_HOURS
    registerDriveOverlay(staffCrossAgentMemoryOverlay)
    registerChangeMaterializer({
      resourceModule: STAFF_RESOURCE.module,
      resourceType: STAFF_RESOURCE.type,
      sensitivity: 'high',
      sensitivityForFields: {
        displayName: 'high',
        email: 'critical',
      },
      promptHint:
        'staff profile — title, availability, capacity, expertise. Identity fields (displayName, email) always pending review.',
      materialize: staffChangeMaterializer,
    })
    registerChangeMaterializer({
      resourceModule: STAFF_MEMORY_RESOURCE.module,
      resourceType: STAFF_MEMORY_RESOURCE.type,
      sensitivity: 'medium',
      promptHint:
        'per-staff-member fact (specialties, working hours, preferred tone). resourceId is `${agentId}:${staffId}`.',
      materialize: staffMemoryChangeMaterializer,
    })
    ctx.cli.registerAll([teamListVerb, teamGetVerb])
  },
}

export default team
