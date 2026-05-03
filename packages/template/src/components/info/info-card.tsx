import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface InfoSectionProps {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}

export function InfoSection({ title, description, actions, children, className }: InfoSectionProps) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex items-start justify-between gap-3 px-1">
        <div className="space-y-0.5">
          <h3 className="font-semibold text-base">{title}</h3>
          {description && <p className="text-muted-foreground text-sm">{description}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

interface InfoCardProps {
  children?: ReactNode
  className?: string
}

export function InfoCard({ children, className }: InfoCardProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg bg-background shadow-sm',
        '[&>*+*]:border-border/50 [&>*+*]:border-t',
        className,
      )}
    >
      {children}
    </div>
  )
}

interface InfoRowProps {
  label: string
  children?: ReactNode
  value?: ReactNode
  fallback?: ReactNode
  className?: string
}

export function InfoRow({ label, children, value, fallback, className }: InfoRowProps) {
  const content = children ?? value
  const isEmpty = content === undefined || content === null || content === ''
  return (
    <div className={cn('flex items-start gap-4 px-4 py-2.5 text-sm', className)}>
      <div className="w-[140px] shrink-0 pt-1.5 text-muted-foreground">{label}</div>
      <div className="min-w-0 flex-1">
        {isEmpty ? (fallback ?? <span className="text-muted-foreground">—</span>) : content}
      </div>
    </div>
  )
}
