import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

function KnowledgeBaseLayout() {
  return <Outlet />;
}

export const Route = createFileRoute('/_app/knowledge-base')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/knowledge-base') {
      throw redirect({ to: '/knowledge-base/search' });
    }
  },
  component: KnowledgeBaseLayout,
});
