/**
 * DriveMarkdownEditor — Platejs-backed markdown editor with debounced autosave.
 * Reads initial markdown from the drive file endpoint, deserialises into the
 * Plate value tree, and on every change re-serialises + persists via
 * `useWriteFile`. The heavy Plate runtime lives behind this component so the
 * preview pane can fall back to a plain `<pre>` for non-markdown files.
 */

import {
  BlockquotePlugin,
  BoldPlugin,
  CodePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  ItalicPlugin,
  StrikethroughPlugin,
  UnderlinePlugin,
} from '@platejs/basic-nodes/react'
import { MarkdownPlugin } from '@platejs/markdown'
import { Plate, PlateContent, usePlateEditor } from 'platejs/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import remarkGfm from 'remark-gfm'
import { type DriveScopeArg, useWriteFile } from '../api/use-drive'

const AUTOSAVE_DEBOUNCE_MS = 600

const plugins = [
  BoldPlugin,
  ItalicPlugin,
  UnderlinePlugin,
  StrikethroughPlugin,
  CodePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  BlockquotePlugin,
  MarkdownPlugin.configure({ options: { remarkPlugins: [remarkGfm] } }),
]

export interface DriveMarkdownEditorProps {
  scope: DriveScopeArg
  path: string
  initialMarkdown: string
}

export function DriveMarkdownEditor({ scope, path, initialMarkdown }: DriveMarkdownEditorProps) {
  const write = useWriteFile(scope)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const lastSerialized = useRef(initialMarkdown)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const editor = usePlateEditor(
    {
      plugins,
      value: (ed) => ed.getApi(MarkdownPlugin).markdown.deserialize(initialMarkdown),
    },
    [path],
  )

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const savedLabel = useMemo(() => {
    switch (status) {
      case 'saving':
        return 'Saving…'
      case 'saved':
        return 'Saved'
      case 'error':
        return 'Save failed'
      default:
        return ''
    }
  }, [status])

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <span className="font-mono text-xs text-muted-foreground">{path}</span>
        <span className="ml-auto text-[11px] text-muted-foreground">{savedLabel}</span>
      </header>
      <div className="flex-1 overflow-auto">
        <Plate
          editor={editor}
          onChange={() => {
            const md = editor.getApi(MarkdownPlugin).markdown.serialize()
            if (md === lastSerialized.current) return
            if (timer.current) clearTimeout(timer.current)
            setStatus('saving')
            timer.current = setTimeout(async () => {
              try {
                await write.mutateAsync({ path, content: md })
                lastSerialized.current = md
                setStatus('saved')
              } catch {
                setStatus('error')
              }
            }, AUTOSAVE_DEBOUNCE_MS)
          }}
        >
          <PlateContent
            className="min-h-full px-4 py-3 text-sm leading-relaxed outline-none"
            placeholder="Start writing…"
          />
        </Plate>
      </div>
    </div>
  )
}
