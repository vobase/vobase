import { createFileRoute, Outlet } from '@tanstack/react-router';

function AgentLayout() {
  return <Outlet />;
}

export const Route = createFileRoute('/_app/agents/$agentId')({
  component: AgentLayout,
});
