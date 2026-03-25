import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

function DashboardLayout() {
  return <Outlet />;
}

export const Route = createFileRoute('/_app/dashboard')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/dashboard') {
      throw redirect({ to: '/dashboard/overview' });
    }
  },
  component: DashboardLayout,
});
