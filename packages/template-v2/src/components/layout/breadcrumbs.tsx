import { useQueryClient } from '@tanstack/react-query'
import { useMatches } from '@tanstack/react-router'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

interface ConvCacheEntry {
  subject?: string
}

interface CrumbDef {
  label: string
  href: string | null
}

function humanize(segment: string): string {
  return segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ')
}

export function Breadcrumbs() {
  const matches = useMatches()
  const qc = useQueryClient()

  const crumbs: CrumbDef[] = []

  for (const match of matches) {
    const { pathname, params } = match as { pathname: string; params: Record<string, string> }

    if (pathname === '/') continue

    const meta = (match as { meta?: { breadcrumbLabel?: string } }).meta

    if (meta?.breadcrumbLabel) {
      crumbs.push({ label: meta.breadcrumbLabel, href: pathname })
      continue
    }

    // inbox contact detail — look up subject from query cache
    if ('contactId' in params && pathname.includes('/inbox/')) {
      const conv = qc.getQueryData<ConvCacheEntry>(['messaging-threads', params.contactId])
      const label = conv?.subject ?? params.contactId.slice(0, 8)
      crumbs.push({ label, href: null })
      continue
    }

    const segment = pathname.split('/').filter(Boolean).pop()
    if (!segment) continue

    crumbs.push({ label: humanize(segment), href: pathname })
  }

  if (crumbs.length === 0) return null

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1
          return (
            <span key={crumb.href ?? crumb.label} className="inline-flex items-center gap-1.5">
              {i > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {isLast || crumb.href === null ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </span>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
