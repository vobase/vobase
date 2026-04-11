import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

function MessagingLayout() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Outlet />
    </div>
  );
}

export const Route = createFileRoute('/_app/messaging')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/messaging') {
      throw redirect({ to: '/messaging/inbox' });
    }
  },
  component: MessagingLayout,
});
