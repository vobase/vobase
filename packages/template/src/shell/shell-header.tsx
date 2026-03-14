import { MenuIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Breadcrumbs } from '@/shell/breadcrumbs'
import { CommandPalette } from '@/shell/command-palette'
import { UserMenu } from '@/shell/user-menu'

export interface ShellHeaderProps {
  onMobileMenuOpen: () => void
}

export function ShellHeader({ onMobileMenuOpen }: Readonly<ShellHeaderProps>) {
  return (
    <>
      <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-sm">
        {/* Left side */}
        <div className="flex items-center gap-3">
          {/* Mobile hamburger */}
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden -ml-1 h-8 w-8 p-0"
            onClick={onMobileMenuOpen}
            aria-label="Open navigation menu"
          >
            <MenuIcon className="h-4 w-4" />
          </Button>
          <Breadcrumbs />
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {/* Cmd+K trigger */}
          <button
            type="button"
            onClick={() => {
              document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
              )
            }}
            className="hidden items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:flex"
            aria-label="Open command palette"
          >
            <span>Search</span>
            <kbd className="pointer-events-none rounded bg-background px-1 py-0.5 font-mono text-[10px] font-medium shadow-sm ring-1 ring-border">
              ⌘K
            </kbd>
          </button>
          <UserMenu />
        </div>
      </header>
      <CommandPalette />
    </>
  )
}
