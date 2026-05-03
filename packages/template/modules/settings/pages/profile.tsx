import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/settings/profile')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/account' })
  },
  component: () => null,
})
