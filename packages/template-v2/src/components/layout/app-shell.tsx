import { useUnreadMentionCount } from '@modules/team/hooks/use-unread-mentions'
import { Link, useNavigate } from '@tanstack/react-router'
import { Bot, HardDrive, Inbox, Radio, Settings, UserCog, Users } from 'lucide-react'
import type * as React from 'react'

import { ThemeSwitch } from '@/components/theme-switch'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useKeyboardNav } from '@/hooks/use-keyboard-nav'
import { useMentionBrowserNotifications } from '@/hooks/use-mention-browser-notifications'
import { useStaffHeartbeat } from '@/hooks/use-staff-heartbeat'
import { cn } from '@/lib/utils'
import { NavUser } from './nav-user'

interface AppShellProps {
  children: React.ReactNode
}

interface NavItemDef {
  icon: React.ElementType
  label: string
  to: string
  enabled: boolean
  badgeCount?: number
}

const PRIMARY_NAV: NavItemDef[] = [
  { icon: Inbox, label: 'Inbox', to: '/inbox', enabled: true },
  { icon: Users, label: 'Contacts', to: '/contacts', enabled: true },
  { icon: Bot, label: 'Agents', to: '/agents', enabled: true },
  { icon: HardDrive, label: 'Drive', to: '/drive', enabled: true },
]

const ADMIN_NAV: NavItemDef[] = [
  { icon: UserCog, label: 'Team', to: '/team', enabled: true },
  { icon: Radio, label: 'Channels', to: '/channels', enabled: true },
  { icon: Settings, label: 'Settings', to: '/settings', enabled: true },
]

function RailItem({ icon: Icon, label, to, enabled, badgeCount }: NavItemDef) {
  const baseClass = 'relative flex size-10 items-center justify-center rounded-md transition-colors'
  const badge =
    badgeCount && badgeCount > 0 ? (
      <span
        role="status"
        aria-label={`${badgeCount} unread`}
        className="absolute top-1 right-1 flex min-w-[16px] items-center justify-center rounded-full bg-primary px-1 font-semibold text-[10px] text-primary-foreground leading-4"
      >
        {badgeCount > 99 ? '99+' : badgeCount}
      </span>
    ) : null
  const trigger = enabled ? (
    <Link
      to={to}
      aria-label={label}
      className={cn(baseClass, 'text-muted-foreground hover:bg-accent hover:text-foreground')}
      activeProps={{ className: cn(baseClass, 'bg-accent text-foreground') }}
    >
      <Icon className="size-[18px]" />
      {badge}
    </Link>
  ) : (
    <button
      type="button"
      aria-label={label}
      aria-disabled="true"
      className={cn(baseClass, 'cursor-default text-muted-foreground opacity-40')}
    >
      <Icon className="size-[18px]" />
      {badge}
    </button>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function AppShell({ children }: AppShellProps) {
  const navigate = useNavigate()
  useKeyboardNav({ context: 'shell', onNavigate: (path) => navigate({ to: path }) })
  useStaffHeartbeat()
  useMentionBrowserNotifications()
  const { data: unreadMentions } = useUnreadMentionCount()

  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <aside
          aria-label="Main navigation"
          className="flex w-14 shrink-0 flex-col items-center border-border border-r bg-sidebar py-3"
        >
          {/* Vobase logo */}
          <div className="mb-3 flex size-10 items-center justify-center">
            <span className="font-bold font-mono text-foreground text-mini tracking-widest">VB</span>
          </div>

          <nav aria-label="Module navigation" className="flex flex-col items-center gap-0.5">
            {PRIMARY_NAV.map((item) => (
              <RailItem key={item.to} {...item} badgeCount={item.to === '/inbox' ? (unreadMentions ?? 0) : undefined} />
            ))}
          </nav>

          <Separator className="my-3 w-8" />

          <nav aria-label="Workspace navigation" className="flex flex-col items-center gap-0.5">
            {ADMIN_NAV.map((item) => (
              <RailItem key={item.to} {...item} />
            ))}
          </nav>

          <div className="mt-auto flex w-full flex-col items-center gap-1 px-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex size-10 items-center justify-center">
                  <ThemeSwitch />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">Toggle theme</TooltipContent>
            </Tooltip>
            <NavUser />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  )
}

export type { AppShellProps }
export { AppShell }
