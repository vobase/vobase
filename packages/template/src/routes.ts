import {
  layout,
  physical,
  rootRoute,
  route,
} from '@tanstack/virtual-file-routes';

export const routes = rootRoute('root.tsx', [
  route('/chat/$endpointId', 'chat.$endpointId.tsx'),
  layout('auth', 'shell/auth/layout.tsx', [
    route('/login', 'shell/auth/login.tsx'),
    route('/signup', 'shell/auth/signup.tsx'),
  ]),
  layout('app', 'shell/app-layout.tsx', [
    route('/', 'home.tsx'),
    route('/sessions', '../modules/conversations/pages/sessions/layout.tsx', [
      route('/', '../modules/conversations/pages/sessions/overview.tsx'),
      route(
        '/$sessionId',
        '../modules/conversations/pages/sessions/$sessionId.tsx',
      ),
    ]),
    route('/contacts', '../modules/conversations/pages/contacts/list.tsx'),
    route(
      '/contacts/$contactId',
      '../modules/conversations/pages/contacts/$contactId.tsx',
    ),
    route('/ai', '../modules/conversations/pages/ai/layout.tsx', [
      physical('../modules/conversations/pages/ai/'),
    ]),
    route('/knowledge-base', '../modules/knowledge-base/pages/layout.tsx', [
      physical('../modules/knowledge-base/pages/'),
    ]),
    route('/system', '../modules/system/pages/layout.tsx', [
      physical('../modules/system/pages/'),
    ]),
    route('/settings', 'shell/settings/layout.tsx', [
      route('/profile', 'shell/settings/profile.tsx'),
      route('/appearance', 'shell/settings/appearance.tsx'),
      route('/api-keys', 'shell/settings/api-keys.tsx'),
      route('/integrations', 'shell/settings/integrations.tsx'),
      route('/organization', 'shell/settings/organization.tsx'),
    ]),
  ]),
]);
