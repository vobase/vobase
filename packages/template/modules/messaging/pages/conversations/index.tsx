import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/messaging/conversations/')({
  beforeLoad: () => {
    throw redirect({ to: '/messaging/inbox' });
  },
});
