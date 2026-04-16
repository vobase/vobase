import { createFileRoute, Navigate } from '@tanstack/react-router';

function MemoryPage() {
  // Working memory feature has been disabled — redirect to agents dashboard
  return <Navigate to="/agents" />;
}

export const Route = createFileRoute('/_app/agents/memory')({
  component: MemoryPage,
});
