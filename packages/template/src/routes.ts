import {
  layout,
  physical,
  rootRoute,
  route,
} from '@tanstack/virtual-file-routes';

export const routes = rootRoute('root.tsx', [
  route('/chat/$channelRoutingId', 'chat.$channelRoutingId.tsx'),
  layout('auth', 'shell/auth/layout.tsx', [
    route('/login', 'shell/auth/login.tsx'),
    route('/pending', 'shell/auth/pending.tsx'),
  ]),
  layout('app', 'shell/app-layout.tsx', [
    route('/', 'home.tsx'),
    route('/agents', '../modules/agents/pages/layout.tsx', [
      physical('../modules/agents/pages/'),
    ]),
    route('/automation', '../modules/automation/pages/layout.tsx', [
      physical('../modules/automation/pages/'),
    ]),
    route('/knowledge-base', '../modules/knowledge-base/pages/layout.tsx'),
    route('/messaging', '../modules/messaging/pages/layout.tsx', [
      physical('../modules/messaging/pages/'),
    ]),
    route('/system', '../modules/system/pages/layout.tsx', [
      physical('../modules/system/pages/'),
    ]),
    route('/settings', 'shell/settings/layout.tsx', [
      route('/profile', 'shell/settings/profile.tsx'),
      route('/account', 'shell/settings/account.tsx'),
      route('/appearance', 'shell/settings/appearance.tsx'),
      route('/notifications', 'shell/settings/notifications.tsx'),
      route('/display', 'shell/settings/display.tsx'),
      route('/api-keys', 'shell/settings/api-keys.tsx'),
    ]),
  ]),
]);
