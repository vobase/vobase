import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { Bell, KeyRound, Monitor, Settings2 } from 'lucide-react'

import { ContentLayout } from '@/components/layout/content-layout'
import type { SubNavItem } from '@/components/layout/sub-nav'
import { SubNav } from '@/components/layout/sub-nav'

export const SETTINGS_NAV_ITEMS: SubNavItem[] = [
  { href: '/settings/account', label: 'Account', icon: <Settings2 /> },
  { href: '/settings/appearance', label: 'Appearance', icon: <Monitor /> },
  { href: '/settings/notifications', label: 'Notifications', icon: <Bell /> },
  { href: '/settings/api-keys', label: 'API Keys', icon: <KeyRound /> },
]

export function SettingsLayout() {
  return <ContentLayout subNav={<SubNav items={SETTINGS_NAV_ITEMS} />} content={<Outlet />} />
}

export default SettingsLayout

export const Route = createFileRoute('/_app/settings')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/settings') {
      throw redirect({ to: '/settings/account' })
    }
  },
  component: SettingsLayout,
})
