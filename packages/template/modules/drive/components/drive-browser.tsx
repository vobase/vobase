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

import { MobileBackBar } from '@/components/layout/mobile-back-bar'
import { useIsMobile } from '@/hooks/use-viewport'
import { DriveFileList } from './drive-file-list'
import { DrivePreview } from './drive-preview'
import { useDriveContext } from './drive-provider'

export type DriveBrowserOrientation = 'horizontal' | 'vertical'

interface DriveBrowserProps {
  /** `horizontal` (default) splits left/right; `vertical` stacks list-on-top, preview-below. */
  orientation?: DriveBrowserOrientation
}

export function DriveBrowser({ orientation = 'horizontal' }: DriveBrowserProps) {
  const { selectedPath, setSelectedPath } = useDriveContext()
  const showPreview = selectedPath !== null
  const isMobile = useIsMobile()

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
    return (
      <div
        className="grid h-full overflow-hidden"
        style={{
          gridTemplateRows: showPreview ? 'minmax(0, 1fr) minmax(0, 2fr)' : 'minmax(0, 1fr)',
        }}
      >
        <section className="min-h-0 overflow-hidden border-border border-b">
          <DriveFileList />
        </section>
        {showPreview && (
          <aside className="min-h-0 overflow-hidden">
            <DrivePreview />
          </aside>
        )}
      </div>
    )
  }

  return (
    <div
      className="grid h-full overflow-hidden"
      style={{
        gridTemplateColumns: showPreview ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)',
      }}
    >
      <section className="min-h-0 overflow-hidden border-border border-r">
        <DriveFileList />
      </section>
      {showPreview && (
        <aside className="min-h-0 overflow-hidden">
          <DrivePreview />
        </aside>
      )}
    </div>
  )
}
