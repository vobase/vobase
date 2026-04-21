import { useUnreadMentionCount } from '@modules/team/api/use-unread-mentions'
import { Link, useNavigate } from '@tanstack/react-router'
import { Bot, CheckSquare, HardDrive, Inbox, MessageCircle, Radio, Settings2, UserCog, Users } from 'lucide-react'
import type * as React from 'react'
import { ThemeSwitch } from '@/components/theme-switch'
import { Kbd } from '@/components/ui/kbd'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useKeyboardNav } from '@/hooks/use-keyboard-nav'
import { useStaffHeartbeat } from '@/hooks/use-staff-heartbeat'
import { cn } from '@/lib/utils'
import { NavUser } from './nav-user'

interface AppShellProps {
  children: React.ReactNode
}

interface NavItemDef {
  icon: React.ElementType
  label: string
  shortcut: string
  to: string
  enabled: boolean
  badgeCount?: number
}

const NAV_ITEMS: NavItemDef[] = [
  { icon: Inbox, label: 'Inbox', shortcut: '⌘1', to: '/inbox', enabled: true },
  { icon: CheckSquare, label: 'Approvals', shortcut: '⌘2', to: '/inbox/approvals', enabled: true },
  { icon: Users, label: 'Contacts', shortcut: '⌘3', to: '/contacts', enabled: true },
  { icon: UserCog, label: 'Team', shortcut: '⌘4', to: '/team', enabled: true },
  { icon: Bot, label: 'Agents', shortcut: '⌘5', to: '/agents', enabled: true },
  { icon: HardDrive, label: 'Drive', shortcut: '⌘6', to: '/drive', enabled: true },
  { icon: Radio, label: 'Channels', shortcut: '⌘7', to: '/channels', enabled: true },
  { icon: Settings2, label: 'Settings', shortcut: '⌘8', to: '/settings', enabled: true },
]

function RailItem({ icon: Icon, label, shortcut, to, enabled, badgeCount }: NavItemDef) {
  const baseClass = 'relative flex size-10 items-center justify-center rounded-md transition-colors'
  const badge =
    badgeCount && badgeCount > 0 ? (
      <span
        role="status"
        aria-label={`${badgeCount} unread`}
        className="absolute right-1 top-1 flex min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground"
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
      <TooltipContent side="right" className="flex items-center gap-2">
        {label}
        <Kbd>{shortcut}</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}

function AppShell({ children }: AppShellProps) {
  const navigate = useNavigate()
  useKeyboardNav({ context: 'shell', onNavigate: (path) => navigate({ to: path }) })
  useStaffHeartbeat()
  const { data: unreadMentions } = useUnreadMentionCount()

  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <aside
          aria-label="Main navigation"
          className="flex w-14 shrink-0 flex-col items-center border-r border-border bg-sidebar py-3"
        >
          {/* Vobase logo */}
          <div className="mb-3 flex size-10 items-center justify-center">
            <span className="font-mono text-mini font-bold tracking-widest text-foreground">VB</span>
          </div>

          <nav aria-label="Module navigation" className="flex flex-col items-center gap-0.5">
            {NAV_ITEMS.map((item) => (
              <RailItem
                key={item.to}
                {...item}
                badgeCount={item.to === '/inbox' ? (unreadMentions ?? 0) : undefined}
              />
            ))}
          </nav>

          <Separator className="my-3 w-8" />

          {/* Dev tools + theme switch pinned above user */}
          <div className="flex flex-col items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/test-web"
                  aria-label="Web channel test client"
                  className="flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <MessageCircle className="size-[18px]" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">Web channel test client</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex size-10 items-center justify-center">
                  <ThemeSwitch />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">Toggle theme</TooltipContent>
            </Tooltip>
          </div>

          {/* Nav-user at rail bottom */}
          <div className="mt-auto w-full px-1">
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
