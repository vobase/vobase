import { layout, physical, rootRoute, route } from '@tanstack/virtual-file-routes'

export const routes = rootRoute('root.tsx', [
  route('/test-web', 'pages/test-web.tsx'),
  route('/chat/$channelInstanceId', 'pages/chat.$channelInstanceId.tsx'),
  layout('auth', 'shell/auth/layout.tsx', [
    route('/auth/login', 'shell/auth/login.tsx'),
    route('/auth/pending', 'shell/auth/pending.tsx'),
  ]),
  layout('app', 'shell/app-layout.tsx', [
    route('/', 'shell/home-redirect.tsx'),
    route('/inbox', '../modules/messaging/pages/layout.tsx', [physical('/', '../modules/messaging/pages')]),
    route('/messaging', 'shell/messaging-redirect.tsx'),
    physical('/contacts', '../modules/contacts/pages'),
    physical('/team', '../modules/team/pages'),
    physical('/agents', '../modules/agents/pages'),
    physical('/drive', '../modules/drive/pages'),
    route('/channels', '../modules/channels/pages/index.tsx'),
    route('/settings', '../modules/settings/pages/layout.tsx', [physical('/', '../modules/settings/pages')]),
  ]),
])
