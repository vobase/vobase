import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

function AILayout() {
  return <Outlet />;
}

// biome-ignore lint/suspicious/noExplicitAny: tsr generate doesn't register sub-layouts from virtual routes
export const Route = createFileRoute('/_app/ai' as any)({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/ai') {
      throw redirect({ to: '/ai/agents' });
    }
  },
  component: AILayout,
});
