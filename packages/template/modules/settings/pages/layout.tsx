import { createFileRoute, Link, Outlet, redirect, useRouterState } from '@tanstack/react-router'
import { Bell, KeyRound, Monitor } from 'lucide-react'

import { PageBody, PageHeader, PageLayout } from '@/components/layout/page-layout'
import { cn } from '@/lib/utils'

const SETTINGS_NAV_ITEMS = [
  { href: '/settings/appearance', label: 'Appearance', icon: Monitor },
  { href: '/settings/notifications', label: 'Notifications', icon: Bell },
  { href: '/settings/api-keys', label: 'API Keys', icon: KeyRound },
]

function SettingsTabs() {
  const path = useRouterState({ select: (s) => s.location.pathname })
  return (
    <nav
      aria-label="Settings sections"
      className="-mx-6 flex shrink-0 gap-1 overflow-x-auto border-border border-b px-6"
    >
      {SETTINGS_NAV_ITEMS.map((item) => {
        const Icon = item.icon
        const active = path.startsWith(item.href)
        return (
          <Link
            key={item.href}
            to={item.href}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors',
              active
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

export function SettingsLayout() {
  return (
    <PageLayout>
      <PageHeader
        title="Settings"
        description="Personal preferences and access keys."
        meta={<SettingsTabs />}
        className="border-b-0"
      />
      <PageBody>
        <div className="mx-auto w-full max-w-4xl space-y-8">
          <Outlet />
        </div>
      </PageBody>
    </PageLayout>
  )
}

export default SettingsLayout

export const Route = createFileRoute('/_app/settings')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/settings') {
      throw redirect({ to: '/settings/appearance' })
    }
  },
  component: SettingsLayout,
})
