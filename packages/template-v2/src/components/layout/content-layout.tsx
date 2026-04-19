import type * as React from 'react'

interface ContentLayoutProps {
  header?: React.ReactNode
  secondaryStrip?: React.ReactNode
  subNav: React.ReactNode
  content: React.ReactNode
  right?: React.ReactNode
}

function ContentLayout({ header, secondaryStrip, subNav, content, right }: ContentLayoutProps) {
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      {header}
      {secondaryStrip && (
        <div className="flex h-8 shrink-0 items-center border-b border-[var(--color-border-subtle)]">
          {secondaryStrip}
        </div>
      )}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="w-[220px] shrink-0 overflow-y-auto border-r border-[var(--color-border-subtle)]">
          {subNav}
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">{content}</div>
        {right && (
          <div className="w-[320px] shrink-0 overflow-y-auto border-l border-[var(--color-border-subtle)]">
            {right}
          </div>
        )}
      </div>
    </div>
  )
}

export type { ContentLayoutProps }
export { ContentLayout }
