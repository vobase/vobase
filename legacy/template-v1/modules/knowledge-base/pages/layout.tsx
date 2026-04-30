import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/knowledge-base')({
  beforeLoad: () => {
    throw redirect({ to: '/agents' })
  },
  component: () => null,
})
