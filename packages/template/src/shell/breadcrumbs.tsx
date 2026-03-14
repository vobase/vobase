import { ChevronRight } from 'lucide-react'
import { useMatches } from '@tanstack/react-router'

import { allNavItems } from '@/data/mockData'
import { cn } from '@/lib/utils'

function labelFromPathname(pathname: string): string | null {
  const item = allNavItems.find((n) => n.to === pathname)
  if (item) return item.label

  // Fallback: capitalize last path segment
  const segment = pathname.split('/').filter(Boolean).pop()
  if (!segment) return null
  return segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ')
}

interface Crumb {
  label: string
  pathname: string
  isLast: boolean
}

export function Breadcrumbs() {
  const matches = useMatches()

  const crumbs: Crumb[] = []
  for (const match of matches) {
    const pathname = match.pathname
    if (pathname === '/' && matches.length > 1) continue
    const label = labelFromPathname(pathname)
    if (!label) continue
    crumbs.push({ label, pathname, isLast: false })
  }

  // Deduplicate consecutive identical pathnames
  const deduped = crumbs.filter((c, i) => i === 0 || c.pathname !== crumbs[i - 1].pathname)

  if (deduped.length === 0) return null

  deduped[deduped.length - 1].isLast = true

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1">
      {deduped.map((crumb, idx) => (
        <span key={crumb.pathname} className="flex items-center gap-1">
          {idx > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />}
          <span
            className={cn(
              'text-sm',
              crumb.isLast
                ? 'font-medium text-foreground'
                : 'text-muted-foreground',
            )}
          >
            {crumb.label}
          </span>
        </span>
      ))}
    </nav>
  )
}
