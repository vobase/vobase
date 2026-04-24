import { Link } from '@tanstack/react-router'
import { FileText, MoreVertical } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { RelativeTimeCard } from '@/components/ui/relative-time-card'
import { Status, StatusIndicator, StatusLabel } from '@/components/ui/status'

type StatusVariant = 'default' | 'success' | 'error' | 'warning' | 'info'

function docStatusVariant(status: string): StatusVariant {
  if (status === 'ready') return 'success'
  if (status === 'pending' || status === 'processing') return 'warning'
  if (status === 'error' || status === 'failed') return 'error'
  return 'default'
}

export type FileIconVariant = 'blue' | 'amber' | 'emerald' | 'violet'

const ICON_TEXT: Record<FileIconVariant, string> = {
  blue: 'text-blue-500',
  amber: 'text-amber-500',
  emerald: 'text-emerald-500',
  violet: 'text-violet-500',
}

const ICON_BG: Record<FileIconVariant, string> = {
  blue: 'bg-blue-500/10',
  amber: 'bg-amber-500/10',
  emerald: 'bg-emerald-500/10',
  violet: 'bg-violet-500/10',
}

interface FileRowProps {
  name: string
  icon?: FileIconVariant
  updatedAt: string
  subtitle?: string
  status?: string
  to?: string
  linkParams?: Record<string, string>
  linkSearch?: Record<string, string>
  menuItems?: React.ReactNode
}

export function FileRow({
  name,
  icon = 'blue',
  updatedAt,
  subtitle,
  status,
  to,
  linkParams,
  linkSearch,
  menuItems,
}: FileRowProps) {
  const content = (
    <>
      <FileText className={`size-4 ${ICON_TEXT[icon]} shrink-0`} />
      <span className="text-sm truncate flex-1">{name}</span>
      {status && (
        <Status variant={docStatusVariant(status)} className="shrink-0 gap-1 px-1.5 py-0 text-[10px]">
          <StatusIndicator className="size-1.5" />
          <StatusLabel className="capitalize">{status}</StatusLabel>
        </Status>
      )}
      {subtitle && <span className="text-xs text-muted-foreground shrink-0">{subtitle}</span>}
      <RelativeTimeCard date={updatedAt} className="text-xs text-muted-foreground shrink-0" />
      {menuItems && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 opacity-0 group-hover:opacity-100 shrink-0"
              onClick={(e) => e.preventDefault()}
            >
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">{menuItems}</DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  )

  if (to) {
    return (
      <Link
        to={to}
        params={linkParams}
        search={linkSearch}
        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent/50 group"
      >
        {content}
      </Link>
    )
  }

  return <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent/50 group">{content}</div>
}

interface FileCardProps {
  name: string
  icon?: FileIconVariant
  updatedAt: string
  subtitle?: string
  status?: string
  to?: string
  linkParams?: Record<string, string>
}

export function FileCard({ name, icon = 'blue', updatedAt, subtitle, status, to, linkParams }: FileCardProps) {
  const content = (
    <>
      <div className={`flex size-10 items-center justify-center rounded-lg ${ICON_BG[icon]}`}>
        <FileText className={`size-5 ${ICON_TEXT[icon]}`} />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm truncate">{name}</p>
          {status && (
            <Status variant={docStatusVariant(status)} className="shrink-0">
              <StatusIndicator />
              <StatusLabel className="capitalize text-xs">{status}</StatusLabel>
            </Status>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {subtitle && <span>{subtitle}</span>}
          <RelativeTimeCard date={updatedAt} />
        </div>
      </div>
    </>
  )

  if (to) {
    return (
      <Link
        to={to}
        params={linkParams}
        className="flex flex-col gap-2 rounded-xl border bg-card p-3 hover:bg-accent/50 transition-colors"
      >
        {content}
      </Link>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-3 hover:bg-accent/50 transition-colors">
      {content}
    </div>
  )
}
