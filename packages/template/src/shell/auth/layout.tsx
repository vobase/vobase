import { createFileRoute, Outlet } from '@tanstack/react-router'

const productName = import.meta.env.VITE_PRODUCT_NAME ?? 'Vobase'
const vendorName = import.meta.env.VITE_VENDOR_NAME ?? 'Vobase'

export function AuthLayout() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background p-4">
      <div className="mb-8">
        <p className="font-bold text-muted-foreground text-xs uppercase tracking-[0.25em]">{productName}</p>
      </div>
      <Outlet />
      <p className="mt-8 text-muted-foreground text-xs">
        &copy; {new Date().getFullYear()} {vendorName}
      </p>
    </div>
  )
}

export const Route = createFileRoute('/_auth')({
  component: AuthLayout,
})
