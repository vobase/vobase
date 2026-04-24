import { createRootRoute, Outlet } from '@tanstack/react-router'
import { Toaster } from 'sonner'

import { NavigationProgress } from '@/components/navigation-progress'
import { SkipToMain } from '@/components/skip-to-main'
import { GeneralError } from '@/features/errors/general-error'
import { NotFoundError } from '@/features/errors/not-found-error'

export const Route = createRootRoute({
  component: () => (
    <>
      <SkipToMain />
      <NavigationProgress />
      <Outlet />
      <Toaster richColors closeButton />
    </>
  ),
  notFoundComponent: NotFoundError,
  errorComponent: GeneralError,
})
