import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

import { PageLayout } from '@/components/layout/page-layout'

function AutomationLayout() {
  return (
    <PageLayout>
      <Outlet />
    </PageLayout>
  )
}

export const Route = createFileRoute('/_app/automation')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/automation') {
      throw redirect({ to: '/automation/tasks' })
    }
  },
  component: AutomationLayout,
})
