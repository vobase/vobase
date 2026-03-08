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
    route('/system', '../modules/system/pages/layout.tsx', [
      physical('../modules/system/pages/'),
    ]),
  ]),
]);
