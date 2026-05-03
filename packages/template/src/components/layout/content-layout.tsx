import type * as React from 'react'

import { useIsMobile } from '@/hooks/use-viewport'
import { cn } from '@/lib/utils'

interface ContentLayoutProps {
  header?: React.ReactNode
  secondaryStrip?: React.ReactNode
  subNav: React.ReactNode
  content: React.ReactNode
  right?: React.ReactNode
}

function ContentLayout({ header, secondaryStrip, subNav, content, right }: ContentLayoutProps) {
  const isMobile = useIsMobile()
  const subNavClass = cn(
    'shrink-0 overflow-y-auto border-[var(--color-border-subtle)]',
    isMobile ? 'overflow-x-auto border-b' : 'w-[220px] border-r',
  )
  const rightClass = cn(
    'shrink-0 overflow-y-auto border-[var(--color-border-subtle)]',
    isMobile ? 'border-t' : 'w-[320px] border-l',
  )

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      {header}
      {secondaryStrip && (
        <div className="flex h-8 shrink-0 items-center border-[var(--color-border-subtle)] border-b">
          {secondaryStrip}
        </div>
      )}
      <div className={cn('flex min-h-0 flex-1 overflow-hidden', isMobile && 'flex-col')}>
        <div className={subNavClass}>{subNav}</div>
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">{content}</div>
        {right && <div className={rightClass}>{right}</div>}
      </div>
    </div>
  )
}

export type { ContentLayoutProps }
export { ContentLayout }
