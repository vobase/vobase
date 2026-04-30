import { createFileRoute, Outlet } from '@tanstack/react-router'

import { PageLayout } from '@/components/layout/page-layout'

function AgentsLayout() {
  return (
    <PageLayout>
      <Outlet />
    </PageLayout>
  )
}

export const Route = createFileRoute('/_app/agents')({
  component: AgentsLayout,
})
