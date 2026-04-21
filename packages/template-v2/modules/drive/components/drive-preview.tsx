/**
 * DrivePreview — read-only text/markdown view of the currently selected file.
 * The Platejs markdown editor lands in slice 5; this component is intentionally
 * render-only so the editor can slot in without reshuffling the browser layout.
 */

import { FileX } from 'lucide-react'
import { useDriveFile } from '../api/use-drive'
import { DriveMarkdownEditor } from './drive-markdown-editor'
import { useDriveContext } from './drive-provider'

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

export function DrivePreview() {
  const { scope, selectedPath } = useDriveContext()
  const { data, isLoading, error } = useDriveFile(scope, selectedPath)

  if (!selectedPath) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a file to preview.
      </div>
    )
  }
  if (isLoading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading…</div>
  }
  if (error) {
    return <div className="p-4 text-sm text-destructive">Failed to load {selectedPath}</div>
  }
  if (!data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <FileX className="size-5" />
        Not found: {selectedPath}
      </div>
    )
  }

  if (isMarkdownPath(selectedPath)) {
    return (
      <DriveMarkdownEditor
        key={`${selectedPath}:${data.content.length}`}
        scope={scope}
        path={selectedPath}
        initialMarkdown={data.content}
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <span className="font-mono text-xs text-muted-foreground">{selectedPath}</span>
        {data.virtual && (
          <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            virtual
          </span>
        )}
      </header>
      <pre className="flex-1 overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-xs leading-relaxed">
        {data.content}
      </pre>
    </div>
  )
}
