import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { type ReactNode, useMemo, useRef, useState } from 'react'
import { Group, Panel, type PanelImperativeHandle, useDefaultLayout } from 'react-resizable-panels'

import { MobileBackBar } from '@/components/layout/mobile-back-bar'
import { GradientResizeHandle } from '@/components/ui/gradient-resize-handle'
import { useIsMobile } from '@/hooks/use-viewport'
import { browserStorage } from '@/lib/browser-storage'
import { cn } from '@/lib/utils'

interface ListDetailLayoutProps {
  list: ReactNode
  detail: ReactNode
  /** Optional filter rail rendered to the LEFT of the list (desktop only). */
  left?: ReactNode
  /** Optional contextual pane rendered to the RIGHT of the detail (gated by `?ctx=open`). */
  right?: ReactNode
  /** Default size of the list pane on desktop. Defaults to 320px. */
  listDefaultSize?: string
  /** Default size of the detail pane on desktop. Defaults adapt to whether `right` is shown. */
  detailDefaultSize?: string
  /** Which pane to show on mobile. Default `'list'`. */
  mobileActive?: 'list' | 'detail'
  /** When set on mobile + showing detail, renders a back bar above the detail content. */
  onMobileBack?: () => void
  /** Unique key for persisting this group's pane sizes to localStorage. */
  storageId?: string
}

const FILTER_DEFAULT_PCT = 18

function ListDetailLayout({
  list,
  detail,
  left,
  right,
  listDefaultSize = '320px',
  detailDefaultSize,
  mobileActive = 'list',
  onMobileBack,
  storageId = 'list-detail',
}: ListDetailLayoutProps) {
  const isMobile = useIsMobile()
  const [ctx] = useQueryState('ctx', { defaultValue: 'closed' })
  const showRight = !!right && ctx === 'open'
  const hasLeft = !!left

  const listRef = useRef<PanelImperativeHandle | null>(null)
  const [listCollapsed, setListCollapsed] = useState(false)
  const [listPct, setListPct] = useState(25)
  const [filterPct, setFilterPct] = useState(FILTER_DEFAULT_PCT)

  const panelIds = useMemo(() => {
    const ids: string[] = []
    if (hasLeft) ids.push('filter')
    ids.push('list', 'detail')
    if (showRight) ids.push('ctx')
    return ids
  }, [hasLeft, showRight])

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: `vobase:${storageId}`,
    storage: browserStorage,
    panelIds,
  })

  if (isMobile) {
    if (mobileActive === 'detail') {
      return (
        <div className="flex h-full flex-col">
          {onMobileBack && <MobileBackBar label="Back" onBack={onMobileBack} ariaLabel="Back to list" />}
          <div className="flex-1 overflow-hidden">{detail}</div>
        </div>
      )
    }
    return <div className="h-full overflow-y-auto">{list}</div>
  }

  const handleListResize = ({ asPercentage }: { asPercentage: number }) => {
    setListPct((prev) => (Math.abs(prev - asPercentage) < 0.05 ? prev : asPercentage))
    const next = listRef.current?.isCollapsed() ?? asPercentage === 0
    setListCollapsed((prev) => (prev === next ? prev : next))
  }

  const handleFilterResize = ({ asPercentage }: { asPercentage: number }) => {
    setFilterPct((prev) => (Math.abs(prev - asPercentage) < 0.05 ? prev : asPercentage))
  }

  const toggleList = () => {
    if (listRef.current?.isCollapsed()) listRef.current.expand()
    else listRef.current?.collapse()
  }

  const detailSize = detailDefaultSize ?? (showRight ? '25%' : '50%')
  const dividerLeftPct = (hasLeft ? filterPct : 0) + listPct

  return (
    <div className="relative h-full">
      <Group
        orientation="horizontal"
        className="h-full"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
      >
        {hasLeft && (
          <>
            <Panel
              id="filter"
              defaultSize={`${FILTER_DEFAULT_PCT}%`}
              minSize="12%"
              maxSize="30%"
              onResize={handleFilterResize}
              className="overflow-y-auto"
            >
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
          maxSize="40%"
          collapsible
          collapsedSize="0%"
          onResize={handleListResize}
          className="overflow-y-auto"
        >
          {list}
        </Panel>

        <GradientResizeHandle hideLine={listCollapsed} />

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

      <button
        type="button"
        onClick={toggleList}
        aria-label={listCollapsed ? 'Show list' : 'Hide list'}
        title={listCollapsed ? 'Show list' : 'Hide list'}
        style={{ left: `${dividerLeftPct}%` }}
        className={cn(
          'absolute top-12 z-20 inline-flex size-6 cursor-pointer items-center justify-center rounded-full bg-background text-muted-foreground shadow-thin transition-colors hover:text-foreground',
          listCollapsed ? '-translate-x-1/4' : '-translate-x-1/2',
        )}
      >
        {listCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronLeft className="size-3.5" />}
      </button>
    </div>
  )
}

export type { ListDetailLayoutProps }
export { ListDetailLayout }
