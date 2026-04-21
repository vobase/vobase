/**
 * DriveBrowser — Google-Drive-style single-pane layout. Shows the current
 * folder's contents as a list; when a file is selected the preview slides in
 * on the right as a details pane.
 *
 * DriveBrowser does not own its scope; wrap it in `<DriveProvider scope={...}>`
 * so the consumer (contact detail, staff detail, /drive page) controls the
 * scope + selected path.
 */

import { DriveFileList } from './drive-file-list'
import { DrivePreview } from './drive-preview'
import { useDriveContext } from './drive-provider'

export function DriveBrowser() {
  const { selectedPath } = useDriveContext()
  const showPreview = selectedPath !== null

  return (
    <div
      className="grid h-full overflow-hidden"
      style={{
        gridTemplateColumns: showPreview ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)',
      }}
    >
      <section className="min-h-0 overflow-hidden border-r border-border">
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
