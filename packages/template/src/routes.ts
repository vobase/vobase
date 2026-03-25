import {
  layout,
  physical,
  rootRoute,
  route,
} from '@tanstack/virtual-file-routes';

export const routes = rootRoute('root.tsx', [
  route('/chat/$inboxId', 'chat.$inboxId.tsx'),
  layout('auth', 'shell/auth/layout.tsx', [
    route('/login', 'shell/auth/login.tsx'),
    route('/signup', 'shell/auth/signup.tsx'),
  ]),
  layout('app', 'shell/app-layout.tsx', [
    route('/', 'home.tsx'),
    route('/ai', '../modules/ai/pages/layout.tsx', [
      physical('../modules/ai/pages/'),
    ]),
    route('/contacts', '../modules/contacts/pages/layout.tsx', [
      physical('../modules/contacts/pages/'),
    ]),
    route('/dashboard', '../modules/dashboard/pages/layout.tsx', [
      physical('../modules/dashboard/pages/'),
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
