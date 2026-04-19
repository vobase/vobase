import { useQueryState } from 'nuqs'
import type * as React from 'react'

interface ListDetailLayoutProps {
  list: React.ReactNode
  detail: React.ReactNode
  right?: React.ReactNode
  listWidth?: 320 | 360
  onMobileSelect?: () => void
}

function ListDetailLayout({ list, detail, right, listWidth = 320 }: ListDetailLayoutProps) {
  const [ctx] = useQueryState('ctx', { defaultValue: 'closed' })

  return (
    <div className="flex h-full overflow-hidden">
      <div
        className="flex shrink-0 flex-col overflow-y-auto border-r border-[var(--color-border-subtle)]"
        style={{ width: listWidth }}
      >
        {list}
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">{detail}</div>

      {right && ctx === 'open' && (
        <div className="flex w-[380px] shrink-0 flex-col overflow-y-auto border-l border-[var(--color-border-subtle)]">
          {right}
        </div>
      )}
    </div>
  )
}

export type { ListDetailLayoutProps }
export { ListDetailLayout }
