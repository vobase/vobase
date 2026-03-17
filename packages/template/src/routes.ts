import {
  layout,
  physical,
  rootRoute,
  route,
} from '@tanstack/virtual-file-routes';

export const routes = rootRoute('root.tsx', [
  layout('auth', 'shell/auth/layout.tsx', [
    route('/login', 'shell/auth/login.tsx'),
    route('/signup', 'shell/auth/signup.tsx'),
  ]),
  layout('app', 'shell/app-layout.tsx', [
    route('/', 'home.tsx'),
    route('/settings', 'shell/settings/layout.tsx', [
      route('/profile', 'shell/settings/profile.tsx'),
      route('/appearance', 'shell/settings/appearance.tsx'),
      route('/api-keys', 'shell/settings/api-keys.tsx'),
      route('/integrations', 'shell/settings/integrations.tsx'),
      route('/organization', 'shell/settings/organization.tsx'),
    ]),
  ]),
]);
