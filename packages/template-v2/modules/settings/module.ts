import { defineModule } from '@server/runtime/define-module'
import handlers from './handlers'
import { createNotificationPrefsService, installNotificationPrefsService } from './service/notification-prefs'

export default defineModule({
  name: 'settings',
  version: '1.0',
  requires: [],
  manifest: {
    provides: {
      commands: [
        'settings:profile',
        'settings:account',
        'settings:appearance',
        'settings:notifications',
        'settings:display',
        'settings:api-keys',
      ],
    },
    permissions: [],
    workspace: { owns: [] },
  },
  routes: { basePath: '/api/settings', handler: handlers, requireSession: true },
  init(ctx) {
    installNotificationPrefsService(createNotificationPrefsService({ db: ctx.db }))
  },
})
