import { createFileRoute, Outlet } from '@tanstack/react-router';

function ChannelsLayout() {
  return <Outlet />;
}

// biome-ignore lint/suspicious/noExplicitAny: tsr generate doesn't register sub-layouts from virtual routes
export const Route = createFileRoute('/_app/conversations/channels' as any)({
  component: ChannelsLayout,
});
