import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Link } from '@tanstack/react-router'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { sidebarNavigation } from '@/constants/navigation'
import { useSidebar } from '@/hooks/use-sidebar'
import { cn } from '@/lib/utils'
import { UserMenu } from '@/shell/user-menu'

export interface ShellSidebarProps {
  className?: string
}

export function ShellSidebar({ className }: Readonly<ShellSidebarProps>) {
  const { isCollapsed, toggle } = useSidebar()

  return (
    <TooltipProvider>
      <aside
        className={cn(
          'flex flex-col border-r bg-sidebar text-sidebar-foreground transition-all duration-200 overflow-hidden',
          isCollapsed ? 'w-[52px]' : 'w-[240px]',
          className,
        )}
      >
        {/* Logo / workspace name */}
        <div className={cn('flex h-12 shrink-0 items-center border-b', isCollapsed ? 'justify-center px-0' : 'px-4')}>
          {isCollapsed ? (
            <span className="text-xs font-bold tracking-widest text-sidebar-foreground select-none">V</span>
          ) : (
            <span className="text-sm font-semibold tracking-tight text-sidebar-foreground select-none">Workspace</span>
          )}
        </div>

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto py-3">
          {sidebarNavigation.map((group, groupIdx) => (
            <div key={group.label} className={cn(groupIdx > 0 && 'mt-4')}>
              {!isCollapsed && (
                <p className="mb-1 px-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                  {group.label}
                </p>
              )}
              {isCollapsed && groupIdx > 0 && (
                <div className="mx-auto mb-2 h-px w-8 bg-border" />
              )}
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <li key={item.to}>
                      {isCollapsed ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Link
                              to={item.to}
                              activeProps={{ className: 'bg-accent text-accent-foreground' }}
                              inactiveProps={{ className: 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground' }}
                              className="mx-auto flex h-8 w-8 items-center justify-center rounded-md transition-colors"
                            >
                              <Icon className="h-4 w-4 shrink-0" />
                              <span className="sr-only">{item.label}</span>
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent side="right">{item.label}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <Link
                          to={item.to}
                          activeProps={{ className: 'bg-accent text-accent-foreground' }}
                          inactiveProps={{ className: 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground' }}
                          className="mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors"
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          {item.label}
                        </Link>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer: user menu + toggle */}
        <div className="shrink-0 border-t">
          {/* User menu */}
          <div className={cn('py-1', isCollapsed ? 'flex justify-center' : 'px-2')}>
            <UserMenu collapsed={isCollapsed} />
          </div>

          {/* Toggle button */}
          <button
            type="button"
            onClick={toggle}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              isCollapsed && 'justify-center px-0',
            )}
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  )
}
