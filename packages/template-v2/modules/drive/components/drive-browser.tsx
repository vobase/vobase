/**
 * DriveBrowser — master/detail composition of the drive primitives. Consumers
 * pass `scope` (organization or a specific contactId); provider + layout live
 * here so pages just drop `<DriveBrowser scope={...} />`.
 */

import type { DriveScopeArg } from '../api/use-drive'
import { DrivePreview } from './drive-preview'
import { DriveProvider } from './drive-provider'
import { DriveTree } from './drive-tree'
import { DriveUpload } from './drive-upload'

export interface DriveBrowserProps {
  scope: DriveScopeArg
}

export function DriveBrowser({ scope }: DriveBrowserProps) {
  return (
    <DriveProvider scope={scope}>
      <div className="grid h-full grid-cols-[280px_1fr] overflow-hidden">
        <aside className="flex flex-col border-r border-border">
          <DriveUpload />
          <DriveTree />
        </aside>
        <main className="overflow-hidden">
          <DrivePreview />
        </main>
      </div>
    </DriveProvider>
  )
}
