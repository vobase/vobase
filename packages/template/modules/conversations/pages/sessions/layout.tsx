import { createFileRoute, Outlet } from '@tanstack/react-router';

function DashboardLayout() {
  return <Outlet />;
}

export const Route = createFileRoute('/_app/sessions')({
  component: DashboardLayout,
});
