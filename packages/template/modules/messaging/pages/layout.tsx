import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

function MessagingLayout() {
  return <Outlet />;
}

export const Route = createFileRoute('/_app/messaging')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/messaging') {
      throw redirect({ to: '/messaging/conversations' });
    }
  },
  component: MessagingLayout,
});
