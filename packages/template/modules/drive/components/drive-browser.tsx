/**
 * DriveBrowser — Google-Drive-style single-pane layout. Shows the current
 * folder's contents as a list; when a file is selected the preview slides in
 * (to the right in horizontal mode, below in vertical mode) as a details pane.
 * On mobile, the preview replaces the file list and a back chevron returns to
 * the list regardless of orientation.
 *
 * DriveBrowser does not own its scope; wrap it in `<DriveProvider scope={...}>`
 * so the consumer (contact detail, staff detail, /drive page) controls the
 * scope + selected path.
 */

import { Group, Panel, useDefaultLayout } from 'react-resizable-panels'

import { MobileBackBar } from '@/components/layout/mobile-back-bar'
import { GradientResizeHandle } from '@/components/ui/gradient-resize-handle'
import { useIsMobile } from '@/hooks/use-viewport'
import { browserStorage } from '@/lib/browser-storage'
import { DriveFileList } from './drive-file-list'
import { DrivePreview } from './drive-preview'
import { useDriveContext } from './drive-provider'

export type DriveBrowserOrientation = 'horizontal' | 'vertical'

interface DriveBrowserProps {
  /** `horizontal` (default) splits left/right; `vertical` stacks list-on-top, preview-below. */
  orientation?: DriveBrowserOrientation
}

const VERTICAL_PANEL_IDS = ['list', 'preview']
const HORIZONTAL_PANEL_IDS = ['list', 'preview']

export function DriveBrowser({ orientation = 'horizontal' }: DriveBrowserProps) {
  const { selectedPath, setSelectedPath } = useDriveContext()
  const showPreview = selectedPath !== null
  const isMobile = useIsMobile()

  const verticalLayout = useDefaultLayout({
    id: 'vobase:drive-vertical',
    storage: browserStorage,
    panelIds: VERTICAL_PANEL_IDS,
  })
  const horizontalLayout = useDefaultLayout({
    id: 'vobase:drive-horizontal',
    storage: browserStorage,
    panelIds: HORIZONTAL_PANEL_IDS,
  })

  if (isMobile) {
    if (showPreview) {
      return (
        <div className="flex h-full flex-col overflow-hidden">
          <MobileBackBar label="Files" onBack={() => setSelectedPath(null)} ariaLabel="Back to files" />
          <div className="min-h-0 flex-1 overflow-hidden">
            <DrivePreview />
          </div>
        </div>
      )
    }
    return (
      <div className="h-full overflow-hidden">
        <DriveFileList />
      </div>
    )
  }

  if (orientation === 'vertical') {
    if (!showPreview) {
      return (
        <div className="h-full overflow-hidden">
          <DriveFileList />
        </div>
      )
    }
    return (
      <Group
        orientation="vertical"
        className="h-full"
        defaultLayout={verticalLayout.defaultLayout}
        onLayoutChanged={verticalLayout.onLayoutChanged}
      >
        <Panel id="list" defaultSize="28%" minSize="15%" maxSize="60%" className="overflow-hidden">
          <DriveFileList />
        </Panel>
        <GradientResizeHandle direction="row" />
        <Panel id="preview" defaultSize="72%" minSize="30%" className="overflow-hidden">
          <DrivePreview />
        </Panel>
      </Group>
    )
  }

  if (!showPreview) {
    return (
      <div className="h-full overflow-hidden">
        <DriveFileList />
      </div>
    )
  }
  return (
    <Group
      orientation="horizontal"
      className="h-full"
      defaultLayout={horizontalLayout.defaultLayout}
      onLayoutChanged={horizontalLayout.onLayoutChanged}
    >
      <Panel id="list" defaultSize="40%" minSize="20%" maxSize="70%" className="overflow-hidden">
        <DriveFileList />
      </Panel>
      <GradientResizeHandle />
      <Panel id="preview" defaultSize="60%" minSize="25%" className="overflow-hidden">
        <DrivePreview />
      </Panel>
    </Group>
  )
}
