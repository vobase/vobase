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
    route('/messaging', '../modules/messaging/pages/layout.tsx', [
      physical('../modules/messaging/pages/'),
    ]),
    route('/agents', '../modules/agents/pages/layout.tsx', [
      physical('../modules/agents/pages/'),
    ]),
    route('/automation', '../modules/automation/pages/layout.tsx', [
      physical('../modules/automation/pages/'),
    ]),
    route('/knowledge-base', '../modules/knowledge-base/pages/layout.tsx', [
      physical('../modules/knowledge-base/pages/'),
    ]),
    route('/system', '../modules/system/pages/layout.tsx', [
      physical('../modules/system/pages/'),
    ]),
    route('/settings', 'shell/settings/layout.tsx', [
      physical('./shell/settings/'),
    ]),
  ]),
]);
