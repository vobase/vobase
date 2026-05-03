import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/settings/display')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/appearance' })
  },
  component: () => null,
})
