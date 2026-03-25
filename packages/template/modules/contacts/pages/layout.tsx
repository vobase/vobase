import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

function ContactsLayout() {
  return <Outlet />;
}

export const Route = createFileRoute('/_app/contacts')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/contacts') {
      throw redirect({ to: '/contacts/contacts' });
    }
  },
  component: ContactsLayout,
});
