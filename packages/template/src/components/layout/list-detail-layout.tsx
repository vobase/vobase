import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { type ReactNode, useRef, useState } from 'react'
import { Group, Panel, type PanelImperativeHandle } from 'react-resizable-panels'

import { GradientResizeHandle } from '@/components/ui/gradient-resize-handle'
import { useViewport } from '@/hooks/use-viewport'

interface ListDetailLayoutProps {
  list: ReactNode
  detail: ReactNode
  /** Optional filter rail rendered to the LEFT of the list (desktop only). */
  left?: ReactNode
  /** Optional contextual pane rendered to the RIGHT of the detail (gated by `?ctx=open`). */
  right?: ReactNode
  /** Default size of the list pane on desktop. Defaults to 32%. */
  listDefaultSize?: string
  /** Default size of the detail pane on desktop. Defaults adapt to whether `right` is shown. */
  detailDefaultSize?: string
  /** Which pane to show on mobile. Default `'list'`. */
  mobileActive?: 'list' | 'detail'
  /** When set on mobile + showing detail, renders a back bar above the detail content. */
  onMobileBack?: () => void
}

function ListDetailLayout({
  list,
  detail,
  left,
  right,
  listDefaultSize = '32%',
  detailDefaultSize,
  mobileActive = 'list',
  onMobileBack,
}: ListDetailLayoutProps) {
  const viewport = useViewport()
  const [ctx] = useQueryState('ctx', { defaultValue: 'closed' })
  const showRight = !!right && ctx === 'open'

  const listRef = useRef<PanelImperativeHandle | null>(null)
  const [listCollapsed, setListCollapsed] = useState(false)

  if (viewport === 'mobile') {
    if (mobileActive === 'detail') {
      return (
        <div className="flex h-full flex-col">
          {onMobileBack && (
            <div className="flex shrink-0 items-center border-border border-b bg-background px-2 py-1">
              <button
                type="button"
                onClick={onMobileBack}
                aria-label="Back to list"
                className="flex h-9 items-center gap-1 rounded-md px-2 text-muted-foreground text-sm hover:bg-foreground-3 hover:text-foreground"
              >
                <ChevronLeft className="size-4" />
                <span>Back</span>
              </button>
            </div>
          )}
          <div className="flex-1 overflow-hidden">{detail}</div>
        </div>
      )
    }
    return <div className="h-full overflow-y-auto">{list}</div>
  }

  const handleListResize = () => {
    const next = listRef.current?.isCollapsed() ?? false
    setListCollapsed((prev) => (prev === next ? prev : next))
  }

  const toggleList = () => {
    if (listRef.current?.isCollapsed()) listRef.current.expand()
    else listRef.current?.collapse()
  }

  const detailSize = detailDefaultSize ?? (showRight ? '25%' : '50%')

  return (
    <Group orientation="horizontal" className="h-full">
      {left && (
        <>
          <Panel id="filter" defaultSize="18%" minSize="12%" maxSize="30%" className="overflow-y-auto">
            {left}
          </Panel>
          <GradientResizeHandle disabled={listCollapsed} />
        </>
      )}

      <Panel
        panelRef={listRef}
        id="list"
        defaultSize={listDefaultSize}
        minSize="240px"
        maxSize="55%"
        collapsible
        collapsedSize="0%"
        onResize={handleListResize}
        className="overflow-y-auto"
      >
        {list}
      </Panel>

      <GradientResizeHandle
        toggle={{
          onClick: toggleList,
          icon: listCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronLeft className="size-3.5" />,
          label: listCollapsed ? 'Show list' : 'Hide list',
        }}
      />

      <Panel id="detail" defaultSize={detailSize} minSize="25%" className="overflow-y-auto">
        {detail}
      </Panel>

      {showRight && (
        <>
          <GradientResizeHandle />
          <Panel id="ctx" defaultSize="25%" minSize="20%" maxSize="40%" className="overflow-y-auto">
            {right}
          </Panel>
        </>
      )}
    </Group>
  )
}

export type { ListDetailLayoutProps }
export { ListDetailLayout }
