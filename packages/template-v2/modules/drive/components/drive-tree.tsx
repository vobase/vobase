/**
 * DriveTree — folder listing for the current parent. Folders descend on click;
 * files select (exposed via DriveProvider's `selectedPath`). Flat list per level;
 * full recursive rendering is intentionally omitted for slice 4.
 */

import { ChevronLeft, File, Folder } from 'lucide-react'
import { useDriveList } from '../api/use-drive'
import { useDriveContext } from './drive-provider'

export function DriveTree() {
  const { scope, parentId, setParentId, selectedPath, setSelectedPath } = useDriveContext()
  const { data: rows = [], isLoading, error } = useDriveList(scope, parentId)

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          disabled={parentId === null}
          onClick={() => setParentId(null)}
          className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
        >
          <ChevronLeft className="size-3.5" /> root
        </button>
        <span className="text-xs text-muted-foreground">
          {scope.scope === 'organization'
            ? 'organization'
            : scope.scope === 'staff'
              ? `staff:${scope.userId}`
              : `contact:${scope.contactId}`}
        </span>
      </div>
      <div className="flex-1 overflow-auto">
        {isLoading && <div className="p-3 text-xs text-muted-foreground">Loading…</div>}
        {error && <div className="p-3 text-xs text-destructive">Failed to load tree</div>}
        {!isLoading && !error && rows.length === 0 && (
          <div className="p-3 text-xs text-muted-foreground">Empty folder.</div>
        )}
        <ul className="py-1">
          {rows.map((row) => {
            const isFolder = row.kind === 'folder'
            const isSelected = !isFolder && row.path === selectedPath
            return (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => (isFolder ? setParentId(row.id) : setSelectedPath(row.path))}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted ${
                    isSelected ? 'bg-muted font-medium' : ''
                  }`}
                >
                  {isFolder ? (
                    <Folder className="size-4 text-muted-foreground" />
                  ) : (
                    <File className="size-4 text-muted-foreground" />
                  )}
                  <span className="truncate">{row.name}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
