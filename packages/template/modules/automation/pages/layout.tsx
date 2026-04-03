import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

function AutomationLayout() {
  return <Outlet />;
}

export const Route = createFileRoute('/_app/automation')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/automation') {
      throw redirect({ to: '/automation/tasks' });
    }
  },
  component: AutomationLayout,
});
