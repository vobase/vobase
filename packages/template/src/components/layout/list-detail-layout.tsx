import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Group, Panel, type PanelImperativeHandle } from 'react-resizable-panels'

import { GradientResizeHandle } from '@/components/ui/gradient-resize-handle'

interface ListDetailLayoutProps {
  list: ReactNode
  detail: ReactNode
  /** Optional filter rail rendered to the LEFT of the list. */
  left?: ReactNode
  /** Optional contextual pane rendered to the RIGHT of the detail (gated by `?ctx=open`). */
  right?: ReactNode
}

function ListDetailLayout({ list, detail, left, right }: ListDetailLayoutProps) {
  const [ctx] = useQueryState('ctx', { defaultValue: 'closed' })
  const showRight = !!right && ctx === 'open'

  const listRef = useRef<PanelImperativeHandle | null>(null)
  const [listCollapsed, setListCollapsed] = useState(false)

  useEffect(() => {
    if (window.innerWidth < 900) {
      listRef.current?.collapse()
    }
  }, [])

  const handleListResize = () => {
    const next = listRef.current?.isCollapsed() ?? false
    setListCollapsed((prev) => (prev === next ? prev : next))
  }

  const toggleList = () => {
    if (listRef.current?.isCollapsed()) listRef.current.expand()
    else listRef.current?.collapse()
  }

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
        defaultSize="32%"
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
          label: listCollapsed ? 'Show conversation list' : 'Hide conversation list',
        }}
      />

      <Panel id="detail" defaultSize={showRight ? '25%' : '50%'} minSize="25%" className="overflow-y-auto">
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
