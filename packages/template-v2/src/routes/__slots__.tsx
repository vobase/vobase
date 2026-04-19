// Phase R'-α slot shims — placeholder components at the agreed default-export paths.
// Phase R'-β: swap these inline components for real lazy imports once AU + SET-SHELL + SET-FORMS + ER land.

export const SLOT_PATHS = {
  // Settings
  profile: '@/pages/settings/profile',
  account: '@/pages/settings/account',
  appearance: '@/pages/settings/appearance',
  notifications: '@/pages/settings/notifications',
  display: '@/pages/settings/display',
  apiKeys: '@/pages/settings/api-keys',
  // Auth
  login: '@/pages/auth/login',
  pending: '@/pages/auth/pending',
  // Errors
  notFound: '@/pages/errors/not-found',
  generalError: '@/pages/errors/general-error',
} as const

export function ProfilePlaceholder() {
  return <div className="p-8 text-muted-foreground">Settings / Profile (coming soon)</div>
}

export function AccountPlaceholder() {
  return <div className="p-8 text-muted-foreground">Settings / Account (coming soon)</div>
}

export function AppearancePlaceholder() {
  return <div className="p-8 text-muted-foreground">Settings / Appearance (coming soon)</div>
}

export function NotificationsPlaceholder() {
  return <div className="p-8 text-muted-foreground">Settings / Notifications (coming soon)</div>
}

export function DisplayPlaceholder() {
  return <div className="p-8 text-muted-foreground">Settings / Display (coming soon)</div>
}

export function ApiKeysPlaceholder() {
  return <div className="p-8 text-muted-foreground">Settings / API Keys (coming soon)</div>
}

export function LoginPlaceholder() {
  return <div className="p-8 text-muted-foreground">Auth / Login (coming soon)</div>
}

export function PendingPlaceholder() {
  return <div className="p-8 text-muted-foreground">Auth / Pending (coming soon)</div>
}

export function NotFoundPlaceholder() {
  return <div className="p-8 text-muted-foreground">404 — Page not found</div>
}

export function GeneralErrorPlaceholder() {
  return <div className="p-8 text-muted-foreground">Something went wrong</div>
}
