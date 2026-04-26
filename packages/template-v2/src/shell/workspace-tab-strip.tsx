/**
 * Chrome-style tab strip for the Workspace surface. Pure-presentation —
 * pulls state from the `workspaceTabsReducer` and dispatches user actions
 * back through the `dispatch` prop. Drag-to-reorder is a planned follow-up.
 */

import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { WorkspaceTab, WorkspaceTabsAction, WorkspaceTabsState } from '@/lib/workspace-tabs'

export interface WorkspaceTabStripProps {
  state: WorkspaceTabsState
  dispatch: (action: WorkspaceTabsAction) => void
}

export function WorkspaceTabStrip({ state, dispatch }: WorkspaceTabStripProps) {
  if (state.tabs.length === 0) {
    return (
      <div className="flex h-9 items-center border-b px-3 text-muted-foreground text-xs">
        No tabs open. Click a path in the tree to open one.
      </div>
    )
  }
  return (
    <div className="flex h-9 items-center gap-px overflow-x-auto border-b">
      {state.tabs.map((tab) => (
        <TabPill
          key={tab.id}
          tab={tab}
          active={state.activeTabId === tab.id}
          onActivate={() => dispatch({ type: 'setActive', tabId: tab.id })}
          onClose={() => dispatch({ type: 'close', tabId: tab.id })}
        />
      ))}
    </div>
  )
}

interface TabPillProps {
  tab: WorkspaceTab
  active: boolean
  onActivate: () => void
  onClose: () => void
}

function TabPill({ tab, active, onActivate, onClose }: TabPillProps) {
  return (
    <div
      className={cn(
        'flex h-9 items-center gap-1 border-r px-3 text-xs',
        active ? 'bg-background' : 'bg-muted/40 text-muted-foreground hover:bg-muted/60',
      )}
    >
      <button type="button" className="max-w-[180px] truncate text-left" onClick={onActivate} title={tab.path}>
        {tab.label}
      </button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Close tab"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      >
        <X className="size-3" />
      </Button>
    </div>
  )
}
