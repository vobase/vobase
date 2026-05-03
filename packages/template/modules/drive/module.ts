import { registerChangeMaterializer } from '@modules/changes/service/proposals'

import type { ModuleDef } from '~/runtime'
import { driveAgent } from './agent'
import { driveVerbs } from './cli'
import { jobs as driveJobs, setJobDeps } from './jobs'
import {
  createAgentBuiltinOverlay,
  createContactBuiltinOverlay,
  createStaffBuiltinOverlay,
} from './service/builtin-overlays'
import { DRIVE_DOC_RESOURCE, driveDocMaterializer } from './service/changes'
import { filesServiceFor, setFilesRuntime } from './service/files'
import { registerDriveOverlay } from './service/overlays'
import { drivePropose } from './verbs/drive-propose'
import * as web from './web'

const drive: ModuleDef = {
  name: 'drive',
  requires: ['changes'],
  web: { routes: web.routes },
  jobs: driveJobs,
  agent: driveAgent,
  init(ctx) {
    setFilesRuntime(ctx.db, ctx.auth, ctx.storage, ctx.jobs, ctx.realtime)
    setJobDeps({
      db: ctx.db,
      storage: ctx.storage,
      jobs: ctx.jobs,
      realtime: ctx.realtime,
    })
    registerChangeMaterializer({
      resourceModule: DRIVE_DOC_RESOURCE.module,
      resourceType: DRIVE_DOC_RESOURCE.type,
      requiresApproval: true,
      materialize: driveDocMaterializer,
    })
    registerDriveOverlay(createContactBuiltinOverlay(ctx.db))
    registerDriveOverlay(createStaffBuiltinOverlay(ctx.db))
    registerDriveOverlay(createAgentBuiltinOverlay(ctx.db))
    ctx.cli.registerAll([...driveVerbs, drivePropose])

    // Best-effort post-boot reaper sweep — picks up rows stuck in (pending,
    // *) older than DRIVE_REAPER_STALE_MS. Fire-and-forget so module init
    // stays synchronous; failures are logged.
    if (ctx.organizationId) {
      const svc = filesServiceFor(ctx.organizationId)
      svc.reapStalePending().catch((err) => console.warn('[drive] reapStalePending failed:', err))
    }
  },
}

export default drive
