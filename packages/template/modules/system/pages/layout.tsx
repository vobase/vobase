import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

import { PageLayout } from '@/components/layout/page-layout';

function SystemLayoutPage() {
  return (
    <PageLayout>
      <Outlet />
    </PageLayout>
  );
}

export const Route = createFileRoute('/_app/system')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/system') {
      throw redirect({ to: '/system/list' });
    }
  },
  component: SystemLayoutPage,
});
