import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

import { PageLayout } from '@/components/layout/page-layout';

function KnowledgeBaseLayout() {
  return (
    <PageLayout>
      <Outlet />
    </PageLayout>
  );
}

export const Route = createFileRoute('/_app/knowledge-base')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/knowledge-base') {
      throw redirect({ to: '/knowledge-base/search' });
    }
  },
  component: KnowledgeBaseLayout,
});
