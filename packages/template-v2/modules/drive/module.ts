import { registerChangeMaterializer } from '@modules/changes/service/proposals'

import type { ModuleDef } from '~/runtime'
import { driveVerbs } from './cli'
import {
  createAgentBuiltinOverlay,
  createContactBuiltinOverlay,
  createStaffBuiltinOverlay,
} from './service/builtin-overlays'
import { DRIVE_DOC_RESOURCE, driveDocMaterializer } from './service/changes'
import { setFilesDb } from './service/files'
import { registerDriveOverlay } from './service/overlays'
import * as web from './web'

const drive: ModuleDef = {
  name: 'drive',
  requires: ['changes'],
  web: { routes: web.routes },
  jobs: [],
  init(ctx) {
    setFilesDb(ctx.db, ctx.auth)
    registerChangeMaterializer({
      resourceModule: DRIVE_DOC_RESOURCE.module,
      resourceType: DRIVE_DOC_RESOURCE.type,
      requiresApproval: true,
      materialize: driveDocMaterializer,
    })
    registerDriveOverlay(createContactBuiltinOverlay(ctx.db))
    registerDriveOverlay(createStaffBuiltinOverlay(ctx.db))
    registerDriveOverlay(createAgentBuiltinOverlay(ctx.db))
    ctx.cli.registerAll(driveVerbs)
  },
}

export default drive
