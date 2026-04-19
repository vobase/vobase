import { Outlet } from '@tanstack/react-router'
import { Bell, KeyRound, LayoutList, Monitor, Settings2, User } from 'lucide-react'
import { ContentLayout } from '@/components/layout/content-layout'
import { SubNav } from '@/components/layout/sub-nav'
import type { SubNavItem } from '@/components/layout/sub-nav'

export const SETTINGS_NAV_ITEMS: SubNavItem[] = [
  { href: '/settings/profile', label: 'Profile', icon: <User /> },
  { href: '/settings/account', label: 'Account', icon: <Settings2 /> },
  { href: '/settings/appearance', label: 'Appearance', icon: <Monitor /> },
  { href: '/settings/notifications', label: 'Notifications', icon: <Bell /> },
  { href: '/settings/display', label: 'Display', icon: <LayoutList /> },
  { href: '/settings/api-keys', label: 'API Keys', icon: <KeyRound /> },
]

export default function SettingsLayout() {
  return (
    <ContentLayout
      subNav={<SubNav items={SETTINGS_NAV_ITEMS} />}
      content={<Outlet />}
    />
  )
}
