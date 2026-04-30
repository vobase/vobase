import { Link } from '@tanstack/react-router'
import type * as React from 'react'

import { cn } from '@/lib/utils'

interface SubNavItem {
  href: string
  label: string
  icon?: React.ReactNode
}

interface SubNavProps {
  items: SubNavItem[]
}

function SubNav({ items }: SubNavProps) {
  return (
    <nav aria-label="Sub navigation" className="flex flex-col gap-0.5 p-2">
      {items.map((item) => (
        <Link
          key={item.href}
          to={item.href}
          activeProps={{ 'aria-current': 'page' as const }}
          className={cn(
            'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm',
            'text-[var(--color-fg-muted)] transition-colors',
            'hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-fg)]',
            '[&[aria-current=page]]:bg-[var(--color-surface-elevated)]',
            '[&[aria-current=page]]:font-medium',
            '[&[aria-current=page]]:text-[var(--color-fg)]',
          )}
        >
          {item.icon && (
            <span className="inline-flex size-4 shrink-0 items-center justify-center [&>svg]:size-4">{item.icon}</span>
          )}
          {item.label}
        </Link>
      ))}
    </nav>
  )
}

export type { SubNavItem, SubNavProps }
export { SubNav }
