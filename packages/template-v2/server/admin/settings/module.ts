import type { ModuleDef } from '@server/common/module-def'

import handlers from './handlers'
import { createNotificationPrefsService, installNotificationPrefsService } from './service/notification-prefs'

const settings: ModuleDef = {
  name: 'settings',
  requires: [],
  web: { routes: { basePath: '/api/settings', handler: handlers, requireSession: true } },
  jobs: [],
  init(ctx) {
    installNotificationPrefsService(createNotificationPrefsService({ db: ctx.db }))
  },
}

export default settings
