import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { manifest } from './manifest'
import { createNotificationPrefsService, installNotificationPrefsService } from './service/notification-prefs'

export default defineModule({
  name: 'settings',
  version: '1.0',
  requires: [],
  manifest,
  routes: { basePath: '/api/settings', handler: handlers, requireSession: true },
  init(ctx) {
    installNotificationPrefsService(createNotificationPrefsService({ db: ctx.db }))
  },
})
