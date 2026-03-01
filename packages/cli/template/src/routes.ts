import { physical, rootRoute, route } from '@tanstack/virtual-file-routes';

export const routes = rootRoute('root.tsx', [
  route('/', 'home.tsx'),
  route('/login', 'shell/auth/login.tsx'),
  route('/signup', 'shell/auth/signup.tsx'),
  route('/system', '../modules/system/pages/layout.tsx', [
    physical('../modules/system/pages/'),
  ]),
]);
