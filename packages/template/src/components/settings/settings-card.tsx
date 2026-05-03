import type { ReactNode } from 'react'
import { Children, isValidElement } from 'react'

import { cn } from '@/lib/utils'

interface SettingsCardProps {
  children?: ReactNode
  divided?: boolean
  className?: string
}

export function SettingsCard({ children, divided = true, className }: SettingsCardProps) {
  const items = Children.toArray(children).filter(isValidElement)

  return (
    <div className={cn('overflow-hidden rounded-xl bg-foreground-3', className)}>
      {items.map((child, i) => (
        <div key={child.key ?? i}>
          {divided && i > 0 && <div className="mx-4 h-px bg-border/50" />}
          {child}
        </div>
      ))}
    </div>
  )
}

interface SettingsCardFooterProps {
  children: ReactNode
  className?: string
}

export function SettingsCardFooter({ children, className }: SettingsCardFooterProps) {
  return <div className={cn('flex justify-end border-t bg-muted/30 px-4 py-3', className)}>{children}</div>
}
