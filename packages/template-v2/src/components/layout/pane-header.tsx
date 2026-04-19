import type * as React from 'react'
import { cn } from '@/lib/utils'

interface PaneHeaderProps {
  title: React.ReactNode
  meta?: React.ReactNode
  actions?: React.ReactNode
  filters?: React.ReactNode
  density?: 'list' | 'detail'
  className?: string
}

function PaneHeader({ title, meta, actions, filters, density = 'list', className }: PaneHeaderProps) {
  return (
    <div
      data-slot="pane-header"
      className={cn(
        'flex h-10 max-h-10 shrink-0 items-center gap-2 border-b border-[var(--color-border-subtle)]',
        density === 'list' ? 'px-3' : 'px-4',
        className,
      )}
    >
      <span className="truncate text-sm font-semibold text-[var(--color-fg)]">{title}</span>
      {meta && <span className="shrink-0 font-mono text-xs text-[var(--color-fg-muted)]">{meta}</span>}
      {filters && <div className="flex shrink-0 items-center gap-1">{filters}</div>}
      {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  )
}

export type { PaneHeaderProps }
export { PaneHeader }
