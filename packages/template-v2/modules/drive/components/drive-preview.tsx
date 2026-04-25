/**
 * DrivePreview — details pane for the currently selected file. Markdown files
 * open in the Plate editor; everything else renders read-only. A close button
 * clears the selection so the list pane expands back to full width.
 */

import { FileX, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useDriveFile } from '../hooks/use-drive'
import { DriveMarkdownEditor } from './drive-markdown-editor'
import { useDriveContext } from './drive-provider'

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

export function DrivePreview() {
  const { scope, selectedPath, setSelectedPath, renderPreview } = useDriveContext()
  const { data, isLoading, error } = useDriveFile(scope, selectedPath)

  if (!selectedPath) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        Select a file to preview.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 border-border border-b px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-muted-foreground text-xs">{selectedPath}</span>
          {data?.virtual && (
            <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase tracking-wide">
              virtual
            </span>
          )}
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 shrink-0"
          onClick={() => setSelectedPath(null)}
          aria-label="Close preview"
        >
          <X className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        {isLoading && <div className="p-4 text-muted-foreground text-sm">Loading…</div>}
        {error && <div className="p-4 text-destructive text-sm">Failed to load {selectedPath}</div>}
        {!isLoading && !error && !data && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground text-sm">
            <FileX className="size-5" />
            Not found: {selectedPath}
          </div>
        )}
        {data &&
          (() => {
            const override = renderPreview?.({ path: selectedPath, content: data.content, scope })
            if (override) return override
            if (isMarkdownPath(selectedPath)) {
              return (
                <DriveMarkdownEditor
                  key={selectedPath}
                  scope={scope}
                  path={selectedPath}
                  initialMarkdown={data.content}
                />
              )
            }
            return (
              <pre className="h-full overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-xs leading-relaxed">
                {data.content}
              </pre>
            )
          })()}
      </div>
    </div>
  )
}
