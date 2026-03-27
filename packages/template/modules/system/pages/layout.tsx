import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

function SystemLayoutPage() {
  return <Outlet />;
}

export const Route = createFileRoute('/_app/system')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/system') {
      throw redirect({ to: '/system/list' });
    }
  },
  component: SystemLayoutPage,
});
