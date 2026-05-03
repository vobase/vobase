import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface PageLayoutProps {
  children: ReactNode
  className?: string
}

function PageLayout({ children, className }: PageLayoutProps) {
  return <div className={cn('flex h-full flex-col overflow-hidden', className)}>{children}</div>
}

interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  /** Optional leading icon — Lucide-style component class, no slot. */
  icon?: ComponentType<{ className?: string }>
  /** Adds a ghost back link before the title. */
  backTo?: { to: string; label: string }
  /** Right-aligned action area (buttons, badges). */
  actions?: ReactNode
  /** Extra row rendered below the title — meta chips, contact info, status. */
  meta?: ReactNode
  className?: string
}

function PageHeader({ title, description, icon: Icon, backTo, actions, meta, className }: PageHeaderProps) {
  return (
    <header className={cn('shrink-0 border-border border-b px-4 py-4 sm:px-6', className)}>
      <div className="flex items-center gap-3">
        {backTo && (
          <Button asChild size="sm" variant="ghost">
            <Link to={backTo.to}>
              <ArrowLeft className="mr-1 size-4" />
              {backTo.label}
            </Link>
          </Button>
        )}
        {Icon && <Icon className="size-5 shrink-0 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold text-lg tracking-tight">{title}</h1>
          {description && <p className="truncate text-muted-foreground text-sm">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {meta && <div className="mt-2">{meta}</div>}
    </header>
  )
}

interface PageBodyProps {
  children: ReactNode
  /** Adds default `px-6 py-4` padding. Disable for full-bleed children. */
  padded?: boolean
  /** Toggles the inner scroll container. Disable when the child manages its own scroll. */
  scroll?: boolean
  className?: string
}

function PageBody({ children, padded = true, scroll = true, className }: PageBodyProps) {
  return (
    <div
      className={cn(
        'flex-1 bg-muted/40',
        scroll ? 'overflow-auto' : 'overflow-hidden',
        padded && 'px-4 py-4 sm:px-6',
        className,
      )}
    >
      {children}
    </div>
  )
}

interface ErrorBannerProps {
  children: ReactNode
  className?: string
}

function ErrorBanner({ children, className }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-sm',
        className,
      )}
    >
      {children}
    </div>
  )
}

export type { ErrorBannerProps, PageBodyProps, PageHeaderProps, PageLayoutProps }
export { ErrorBanner, PageBody, PageHeader, PageLayout }
