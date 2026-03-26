import { createFileRoute, Outlet } from '@tanstack/react-router';

function ConversationsLayout() {
  return <Outlet />;
}

export const Route = createFileRoute('/_app/conversations')({
  component: ConversationsLayout,
});
