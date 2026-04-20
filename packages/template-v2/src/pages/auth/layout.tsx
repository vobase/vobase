import { Outlet } from '@tanstack/react-router'

const productName = import.meta.env.VITE_PRODUCT_NAME ?? 'Vobase'
const vendorName = import.meta.env.VITE_VENDOR_NAME ?? 'Vobase'

export function AuthLayout() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background p-4">
      <div className="mb-8">
        <p className="text-xs font-bold tracking-[0.25em] text-muted-foreground uppercase">{productName}</p>
      </div>
      <Outlet />
      <p className="mt-8 text-xs text-muted-foreground">
        &copy; {new Date().getFullYear()} {vendorName}
      </p>
    </div>
  )
}
