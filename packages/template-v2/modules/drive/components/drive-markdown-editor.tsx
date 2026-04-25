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
import { MarkdownPlugin, remarkMdx } from '@platejs/markdown'
import { Bold, Code, Heading1, Heading2, Heading3, Italic, Quote, Strikethrough, Underline } from 'lucide-react'
import {
  Plate,
  PlateContent,
  PlateElement,
  type PlateElementProps,
  PlateLeaf,
  type PlateLeafProps,
  useEditorRef,
  useEditorSelector,
  usePlateEditor,
} from 'platejs/react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import remarkGfm from 'remark-gfm'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { type DriveScopeArg, useWriteFile } from '../api/use-drive'

const AUTOSAVE_DEBOUNCE_MS = 600

const BoldLeaf = (props: PlateLeafProps) => <PlateLeaf {...props} as="strong" />
const ItalicLeaf = (props: PlateLeafProps) => <PlateLeaf {...props} as="em" />
const UnderlineLeaf = (props: PlateLeafProps) => <PlateLeaf {...props} as="u" />
const StrikethroughLeaf = (props: PlateLeafProps) => <PlateLeaf {...props} as="s" />
const CodeLeaf = (props: PlateLeafProps) => (
  <PlateLeaf {...props} as="code" className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" />
)

const H1Element = (props: PlateElementProps) => (
  <PlateElement {...props} as="h1" className="mt-4 mb-2 font-semibold text-2xl tracking-tight" />
)
const H2Element = (props: PlateElementProps) => (
  <PlateElement {...props} as="h2" className="mt-4 mb-2 font-semibold text-xl tracking-tight" />
)
const H3Element = (props: PlateElementProps) => (
  <PlateElement {...props} as="h3" className="mt-3 mb-1.5 font-semibold text-lg tracking-tight" />
)
const BlockquoteElement = (props: PlateElementProps) => (
  <PlateElement
    {...props}
    as="blockquote"
    className="my-2 border-border border-l-2 pl-3 text-muted-foreground italic"
  />
)

const plugins = [
  BoldPlugin.withComponent(BoldLeaf),
  ItalicPlugin.withComponent(ItalicLeaf),
  UnderlinePlugin.withComponent(UnderlineLeaf),
  StrikethroughPlugin.withComponent(StrikethroughLeaf),
  CodePlugin.withComponent(CodeLeaf),
  H1Plugin.withComponent(H1Element),
  H2Plugin.withComponent(H2Element),
  H3Plugin.withComponent(H3Element),
  BlockquotePlugin.withComponent(BlockquoteElement),
  MarkdownPlugin.configure({ options: { remarkPlugins: [remarkGfm, remarkMdx] } }),
]

function MarkButton({ markKey, icon, label }: { markKey: string; icon: ReactNode; label: string }) {
  const editor = useEditorRef()
  const active = useEditorSelector((ed) => ed.api.hasMark(markKey), [markKey])
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      aria-label={label}
      aria-pressed={active}
      className={cn('size-7', active && 'bg-muted text-foreground')}
      onMouseDown={(e) => {
        e.preventDefault()
        editor.tf.toggleMark(markKey)
      }}
    >
      {icon}
    </Button>
  )
}

function BlockButton({ blockType, icon, label }: { blockType: string; icon: ReactNode; label: string }) {
  const editor = useEditorRef()
  const active = useEditorSelector(
    (ed) => {
      const b = ed.api.block()
      return Boolean(b && (b[0] as { type?: string }).type === blockType)
    },
    [blockType],
  )
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      aria-label={label}
      aria-pressed={active}
      className={cn('size-7', active && 'bg-muted text-foreground')}
      onMouseDown={(e) => {
        e.preventDefault()
        editor.tf.toggleBlock(blockType)
      }}
    >
      {icon}
    </Button>
  )
}

function Toolbar({ statusLabel }: { statusLabel: string }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-border border-b px-2 py-1">
      <MarkButton markKey="bold" label="Bold" icon={<Bold className="size-3.5" />} />
      <MarkButton markKey="italic" label="Italic" icon={<Italic className="size-3.5" />} />
      <MarkButton markKey="underline" label="Underline" icon={<Underline className="size-3.5" />} />
      <MarkButton markKey="strikethrough" label="Strikethrough" icon={<Strikethrough className="size-3.5" />} />
      <MarkButton markKey="code" label="Inline code" icon={<Code className="size-3.5" />} />
      <span className="mx-1 h-4 w-px bg-border" />
      <BlockButton blockType="h1" label="Heading 1" icon={<Heading1 className="size-3.5" />} />
      <BlockButton blockType="h2" label="Heading 2" icon={<Heading2 className="size-3.5" />} />
      <BlockButton blockType="h3" label="Heading 3" icon={<Heading3 className="size-3.5" />} />
      <BlockButton blockType="blockquote" label="Quote" icon={<Quote className="size-3.5" />} />
      <span className="ml-auto pr-1 text-[11px] text-muted-foreground">{statusLabel}</span>
    </div>
  )
}

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
    // Seed lastSerialized with the editor's own round-tripped form so the
    // initial onChange (fired during mount after deserialize) doesn't look
    // like a user edit and autosave an untouched file.
    lastSerialized.current = editor.getApi(MarkdownPlugin).markdown.serialize()
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [editor])

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
        <Toolbar statusLabel={savedLabel} />
        <div className="flex-1 overflow-auto">
          <PlateContent
            className="min-h-full px-4 py-3 text-sm leading-relaxed outline-none"
            placeholder="Start writing…"
          />
        </div>
      </Plate>
    </div>
  )
}
