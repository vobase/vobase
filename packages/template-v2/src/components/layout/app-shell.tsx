import { Link } from '@tanstack/react-router'
import { Bot, CheckSquare, HardDrive, Inbox, Settings2, Users } from 'lucide-react'
import type * as React from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Kbd } from '@/components/ui/kbd'
import { Status } from '@/components/ui/status'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface AppShellProps {
  children: React.ReactNode
}

interface NavItemDef {
  icon: React.ElementType
  label: string
  shortcut: string
  to: string
  enabled: boolean
}

const NAV_ITEMS: NavItemDef[] = [
  { icon: Inbox, label: 'Inbox', shortcut: '⌘1', to: '/inbox', enabled: true },
  { icon: CheckSquare, label: 'Approvals', shortcut: '⌘2', to: '/approvals', enabled: false },
  { icon: Users, label: 'Contacts', shortcut: '⌘3', to: '/contacts', enabled: false },
  { icon: Bot, label: 'Agents', shortcut: '⌘4', to: '/agents', enabled: false },
  { icon: HardDrive, label: 'Drive', shortcut: '⌘5', to: '/drive', enabled: false },
  { icon: Settings2, label: 'Settings', shortcut: '⌘6', to: '/settings', enabled: false },
]

function RailItem({ icon: Icon, label, shortcut, to, enabled }: NavItemDef) {
  const baseClass = 'flex size-10 items-center justify-center rounded-md transition-colors'
  const trigger = enabled ? (
    <Link
      to={to}
      aria-label={label}
      className={cn(
        baseClass,
        'text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-fg)]',
      )}
      activeProps={{ className: cn(baseClass, 'bg-[var(--color-surface-elevated)] text-[var(--color-fg)]') }}
    >
      <Icon className="size-[18px]" />
    </Link>
  ) : (
    <button
      type="button"
      aria-label={label}
      aria-disabled="true"
      className={cn(baseClass, 'cursor-default text-[var(--color-fg-subtle)] opacity-40')}
    >
      <Icon className="size-[18px]" />
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
  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden bg-[var(--color-bg)] text-[var(--color-fg)]">
        <aside
          aria-label="Main navigation"
          className="flex w-14 shrink-0 flex-col items-center border-r border-[var(--color-border-subtle)] bg-[var(--color-surface)] py-3"
        >
          {/* Vobase logo */}
          <div className="mb-3 flex size-10 items-center justify-center">
            <span className="font-mono text-[11px] font-bold tracking-widest text-[var(--color-fg)]">VB</span>
          </div>

          <nav aria-label="Module navigation" className="flex flex-col items-center gap-0.5">
            {NAV_ITEMS.map((item) => (
              <RailItem key={item.to} {...item} />
            ))}
          </nav>

          {/* User avatar with status dot */}
          <div className="relative mt-auto">
            <Avatar className="size-8">
              <AvatarFallback className="bg-[var(--color-surface-elevated)] text-[10px] text-[var(--color-fg-muted)]">
                U
              </AvatarFallback>
            </Avatar>
            <span className="absolute -bottom-0.5 -right-0.5">
              <Status variant="active" label="" className="gap-0" />
            </span>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </TooltipProvider>
  )
}

export type { AppShellProps }
export { AppShell }
