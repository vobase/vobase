import type { ModuleDef } from '~/runtime'
import handlers from './handlers'
import { createApiKeysService, installApiKeysService } from './service/api-keys'
import { createNotificationPrefsService, installNotificationPrefsService } from './service/notification-prefs'
import { createOrgSettingsService, installOrgSettingsService } from './service/org-settings'

const settings: ModuleDef = {
  name: 'settings',
  requires: [],
  web: { routes: { basePath: '/api/settings', handler: handlers, requireSession: true } },
  jobs: [],
  init(ctx) {
    installNotificationPrefsService(createNotificationPrefsService({ db: ctx.db }))
    installApiKeysService(createApiKeysService({ db: ctx.db }))
    installOrgSettingsService(createOrgSettingsService({ db: ctx.db }))
  },
}

export default settings
