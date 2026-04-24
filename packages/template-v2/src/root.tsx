import { createRootRoute, Outlet } from '@tanstack/react-router'

import { Toaster } from '@/components/ui/sonner'
import GeneralErrorPage from '@/pages/errors/general-error'
import NotFoundPage from '@/pages/errors/not-found'

export const Route = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <Toaster richColors closeButton />
    </>
  ),
  notFoundComponent: NotFoundPage,
  errorComponent: GeneralErrorPage,
})
