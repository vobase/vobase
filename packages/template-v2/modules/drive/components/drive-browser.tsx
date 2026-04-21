/**
 * DriveBrowser — master/detail layout composed of the drive primitives.
 *
 * DriveBrowser no longer owns its scope; wrap it in `<DriveProvider scope={...}>`
 * so the consumer (contact detail, staff detail, /drive page) controls the
 * scope + selected path and can co-locate other panels that share state.
 */

import { DrivePreview } from './drive-preview'
import { DriveTree } from './drive-tree'
import { DriveUpload } from './drive-upload'

export function DriveBrowser() {
  return (
    <div className="grid h-full grid-cols-[280px_1fr] overflow-hidden">
      <aside className="flex flex-col border-r border-border">
        <DriveUpload />
        <DriveTree />
      </aside>
      <main className="overflow-hidden">
        <DrivePreview />
      </main>
    </div>
  )
}
