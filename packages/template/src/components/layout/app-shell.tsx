import { usePendingChangesCount } from '@modules/changes/hooks/use-change-inbox'
import { useUnreadMentionCount } from '@modules/team/hooks/use-unread-mentions'
import { Link, useNavigate } from '@tanstack/react-router'
import { Bot, GitPullRequestArrow, HardDrive, Inbox, Menu, Radio, Settings, UserCog, Users } from 'lucide-react'
import type * as React from 'react'
import { useState } from 'react'
import { Group, Panel, useDefaultLayout } from 'react-resizable-panels'

import { ThemeSwitch } from '@/components/theme-switch'
import { GradientResizeHandle } from '@/components/ui/gradient-resize-handle'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useKeyboardNav } from '@/hooks/use-keyboard-nav'
import { useMentionBrowserNotifications } from '@/hooks/use-mention-browser-notifications'
import { useStaffHeartbeat } from '@/hooks/use-staff-heartbeat'
import { useIsMobile } from '@/hooks/use-viewport'
import { browserStorage } from '@/lib/browser-storage'
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
  { icon: GitPullRequestArrow, label: 'Changes', to: '/changes', enabled: true },
]

const ADMIN_NAV: NavItemDef[] = [
  { icon: UserCog, label: 'Team', to: '/team', enabled: true },
  { icon: Radio, label: 'Channels', to: '/channels', enabled: true },
  { icon: Settings, label: 'Settings', to: '/settings', enabled: true },
]

function NavItem({ icon: Icon, label, to, enabled, badgeCount }: NavItemDef) {
  const base =
    'group/nav-item relative flex h-9 items-center gap-3 rounded-md px-2.5 text-sm transition-colors @max-[160px]/rail:justify-center @max-[160px]/rail:gap-0 @max-[160px]/rail:px-0'
  const idle = 'text-muted-foreground hover:bg-foreground-3 hover:text-foreground'
  const active = 'bg-foreground-5 text-foreground'

  const badge =
    badgeCount && badgeCount > 0 ? (
      <span
        role="status"
        aria-label={`${badgeCount} unread`}
        className="@max-[160px]/rail:absolute @max-[160px]/rail:top-1 @max-[160px]/rail:right-1 @max-[160px]/rail:ml-0 ml-auto inline-flex @max-[160px]/rail:h-1.5 h-5 @max-[160px]/rail:min-w-1.5 min-w-5 items-center justify-center rounded-full bg-primary @max-[160px]/rail:p-0 px-1.5 font-semibold @max-[160px]/rail:text-transparent text-primary-foreground text-xs leading-none"
      >
        {badgeCount > 99 ? '99+' : badgeCount}
      </span>
    ) : null

  if (!enabled) {
    return (
      <button
        type="button"
        aria-label={label}
        aria-disabled="true"
        className={cn(base, 'cursor-default text-muted-foreground opacity-40')}
      >
        <Icon className="size-[18px] shrink-0" />
        <span className="@max-[160px]/rail:hidden truncate">{label}</span>
        {badge}
      </button>
    )
  }

  return (
    <Link to={to} aria-label={label} className={cn(base, idle)} activeProps={{ className: cn(base, active) }}>
      <Icon className="size-[18px] shrink-0" />
      <span className="@max-[160px]/rail:hidden truncate">{label}</span>
      {badge}
    </Link>
  )
}

function MobileBottomNavItem({ icon: Icon, label, to, enabled, badgeCount }: NavItemDef) {
  const base = 'relative flex flex-col items-center justify-center gap-0.5 transition-colors'
  const idle = 'text-muted-foreground'
  const active = 'text-foreground'

  const badge =
    badgeCount && badgeCount > 0 ? (
      <span
        role="status"
        aria-label={`${badgeCount} unread`}
        className="absolute top-1.5 right-1/4 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 font-semibold text-2xs text-primary-foreground leading-none"
      >
        {badgeCount > 99 ? '99+' : badgeCount}
      </span>
    ) : null

  if (!enabled) {
    return (
      <button type="button" disabled aria-label={label} className={cn(base, 'opacity-40')}>
        <Icon className="size-5" />
        <span className="text-2xs">{label}</span>
      </button>
    )
  }

  return (
    <Link to={to} aria-label={label} className={cn(base, idle)} activeProps={{ className: cn(base, active) }}>
      <Icon className="size-5" />
      <span className="text-2xs">{label}</span>
      {badge}
    </Link>
  )
}

function MobileMoreNavRow({ icon: Icon, label, to, enabled, onClick }: NavItemDef & { onClick: () => void }) {
  const base = 'flex h-12 items-center gap-3 rounded-md px-3 text-sm transition-colors'
  const idle = 'text-foreground hover:bg-foreground-3'
  const active = 'bg-foreground-5'

  if (!enabled) {
    return (
      <button type="button" disabled aria-label={label} className={cn(base, 'opacity-40')}>
        <Icon className="size-5" />
        <span>{label}</span>
      </button>
    )
  }

  return (
    <Link to={to} onClick={onClick} className={cn(base, idle)} activeProps={{ className: cn(base, active) }}>
      <Icon className="size-5" />
      <span>{label}</span>
    </Link>
  )
}

function DesktopShell({
  children,
  badgeFor,
}: {
  children: React.ReactNode
  badgeFor: (to: string) => number | undefined
}) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'vobase:app-shell',
    storage: browserStorage,
  })
  return (
    <Group
      orientation="horizontal"
      style={{ height: '100dvh' }}
      className="bg-background text-foreground"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <Panel id="rail" defaultSize="180px" minSize="160px" maxSize="240px" collapsible collapsedSize="56px">
        <aside
          aria-label="Main navigation"
          className="@container/rail flex h-full w-full flex-col bg-sidebar px-2 py-3"
        >
          <div className="mb-3 flex h-9 items-center @max-[160px]/rail:justify-center @max-[160px]/rail:px-0 px-2.5">
            <span className="@max-[160px]/rail:hidden font-bold font-mono text-foreground text-sm tracking-widest">
              VOBASE
            </span>
            <span className="@max-[160px]/rail:inline hidden font-bold font-mono text-foreground text-sm tracking-widest">
              V
            </span>
          </div>

          <nav aria-label="Module navigation" className="flex flex-col gap-0.5">
            {PRIMARY_NAV.map((item) => (
              <NavItem key={item.to} {...item} badgeCount={badgeFor(item.to)} />
            ))}
          </nav>

          <Separator className="-mx-2 my-1" />

          <nav aria-label="Workspace navigation" className="flex flex-col gap-0.5">
            {ADMIN_NAV.map((item) => (
              <NavItem key={item.to} {...item} />
            ))}
          </nav>

          <div className="mt-auto flex flex-col gap-1">
            <div className="flex h-9 items-center @max-[160px]/rail:justify-center @max-[160px]/rail:gap-0 gap-3 rounded-md @max-[160px]/rail:px-0 px-2.5 text-muted-foreground text-sm">
              <ThemeSwitch />
              <span className="@max-[160px]/rail:hidden">Theme</span>
            </div>
            <NavUser />
          </div>
        </aside>
      </Panel>

      <GradientResizeHandle />

      <Panel id="main" defaultSize="86%" minSize="50%">
        <main className="h-full overflow-hidden">{children}</main>
      </Panel>
    </Group>
  )
}

function MobileShell({
  children,
  badgeFor,
}: {
  children: React.ReactNode
  badgeFor: (to: string) => number | undefined
}) {
  const [moreOpen, setMoreOpen] = useState(false)

  return (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground">
      <main className="flex-1 overflow-hidden">{children}</main>
      <nav aria-label="Main navigation" className="grid h-14 shrink-0 grid-cols-6 border-border border-t bg-sidebar">
        {PRIMARY_NAV.map((item) => (
          <MobileBottomNavItem key={item.to} {...item} badgeCount={badgeFor(item.to)} />
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-label="More"
          className="relative flex flex-col items-center justify-center gap-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <Menu className="size-5" />
          <span className="text-2xs">More</span>
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="h-auto">
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <nav aria-label="Workspace navigation" className="flex flex-col gap-1 px-1 pb-2">
            {ADMIN_NAV.map((item) => (
              <MobileMoreNavRow key={item.to} {...item} onClick={() => setMoreOpen(false)} />
            ))}
          </nav>
          <Separator className="-mx-2 my-1" />
          <div className="flex items-center justify-between px-3 pb-2">
            <div className="flex items-center gap-3 text-muted-foreground text-sm">
              <ThemeSwitch />
              <span>Theme</span>
            </div>
            <NavUser />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function AppShell({ children }: AppShellProps) {
  const navigate = useNavigate()
  useKeyboardNav({ context: 'shell', onNavigate: (path) => navigate({ to: path }) })
  useStaffHeartbeat()
  useMentionBrowserNotifications()
  const { data: unreadMentions } = useUnreadMentionCount()
  const pendingChanges = usePendingChangesCount()
  const isMobile = useIsMobile()

  function badgeFor(to: string): number | undefined {
    if (to === '/inbox') return unreadMentions ?? 0
    if (to === '/changes') return pendingChanges
    return undefined
  }

  return (
    <TooltipProvider>
      {isMobile ? (
        <MobileShell badgeFor={badgeFor}>{children}</MobileShell>
      ) : (
        <DesktopShell badgeFor={badgeFor}>{children}</DesktopShell>
      )}
    </TooltipProvider>
  )
}

export type { AppShellProps }
export { AppShell }
