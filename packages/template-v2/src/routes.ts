import { layout, physical, rootRoute, route } from '@tanstack/virtual-file-routes'

export const routes = rootRoute('root.tsx', [
  route('/test-web', 'pages/test-web.tsx'),
  layout('auth', 'shell/auth/layout.tsx', [
    route('/auth/login', 'shell/auth/login.tsx'),
    route('/auth/pending', 'shell/auth/pending.tsx'),
  ]),
  layout('app', 'shell/app-layout.tsx', [
    route('/', 'shell/home-redirect.tsx'),
    route('/inbox', '../modules/inbox/pages/layout.tsx', [
      physical('/', '../modules/inbox/pages'),
    ]),
    physical('/contacts', '../modules/contacts/pages'),
    physical('/agents', '../modules/agents/pages'),
    physical('/drive', '../modules/drive/pages'),
    physical('/channels', '../modules/channels/pages'),
    route('/settings', '../modules/settings/pages/layout.tsx', [
      physical('/', '../modules/settings/pages'),
    ]),
  ]),
])
