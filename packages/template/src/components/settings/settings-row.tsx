import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface SettingsRowProps {
  label: string
  description?: string
  children?: ReactNode
  action?: ReactNode
  className?: string
}

export function SettingsRow({ label, description, children, action, className }: SettingsRowProps) {
  return (
    <div className={cn('flex items-center justify-between px-4 py-3.5', className)}>
      <div className="min-w-0 flex-1">
        <span className="font-medium text-sm">{label}</span>
        {description && <p className="mt-0.5 text-muted-foreground text-xs">{description}</p>}
      </div>
      <div className="ml-4 flex shrink-0 items-center gap-2">
        {children}
        {action}
      </div>
    </div>
  )
}
