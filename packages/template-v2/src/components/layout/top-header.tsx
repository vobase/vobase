import { Search } from 'lucide-react'

import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Breadcrumbs } from './breadcrumbs'

export function TopHeader() {
  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-4">
      <div className="flex min-w-0 flex-1 items-center">
        <Breadcrumbs />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Search (coming soon)" title="Search (coming soon)" disabled>
          <Search aria-hidden="true" />
        </Button>
        <ThemeSwitch />
      </div>
    </header>
  )
}
