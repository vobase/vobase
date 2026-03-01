import { createRootRoute, Outlet } from '@tanstack/react-router';

import { Layout } from './shell/layout';

export const Route = createRootRoute({
  component: () => (
    <Layout>
      <Outlet />
    </Layout>
  ),
});
