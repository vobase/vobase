/**
 * DriveMarkdownEditor — Platejs-backed markdown editor with manual save.
 * Reads initial markdown from the drive file endpoint, deserialises into the
 * Plate value tree, and persists via `useWriteFile` when the user clicks Save.
 * Dirty detection compares against the editor's own round-tripped baseline
 * (set on mount and after each save) so an untouched file is never marked
 * dirty, even when deserialize → serialize is not byte-identical.
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
import { TableCellHeaderPlugin, TableCellPlugin, TablePlugin, TableRowPlugin } from '@platejs/table/react'
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Lock,
  Quote,
  Save,
  Strikethrough,
  Underline,
} from 'lucide-react'
import { createSlateEditor, type Value } from 'platejs'
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
import { PlateStatic } from 'platejs/static'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import remarkGfm from 'remark-gfm'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { type DriveScopeArg, useWriteFile } from '../hooks/use-drive'

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

// GFM tables. Without these element components, the table plugin's nodes
// (`table`/`tr`/`td`/`th`) deserialize but render as blank space because
// Plate has no element registered for those types. Used both for the
// frontmatter overview rendered above the editor and for any GFM tables
// that appear in the markdown body.
const TableElement = (props: PlateElementProps) => (
  <div className="my-3 overflow-x-auto">
    <PlateElement
      {...props}
      as="table"
      className="w-full border-collapse border border-border text-xs [&_td]:p-2 [&_th]:p-2"
    />
  </div>
)
const TableRowElement = (props: PlateElementProps) => (
  <PlateElement {...props} as="tr" className="border-border border-b last:border-b-0" />
)
const TableCellElement = (props: PlateElementProps) => (
  <PlateElement {...props} as="td" className="border-border border-r align-top last:border-r-0" />
)
const TableCellHeaderElement = (props: PlateElementProps) => (
  <PlateElement
    {...props}
    as="th"
    className="border-border border-r bg-muted text-left align-top font-semibold last:border-r-0"
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
  TablePlugin.withComponent(TableElement),
  TableRowPlugin.withComponent(TableRowElement),
  TableCellPlugin.withComponent(TableCellElement),
  TableCellHeaderPlugin.withComponent(TableCellHeaderElement),
  // Do NOT add `remarkMdx` to the remark pipeline: it parses `<id>` / `<file>`
  // / `<number>` style tokens (common in drive docs — agent MEMORY.md, skill
  // files, command examples) as JSX components and silently truncates the
  // document at the first one. `remarkGfm` alone covers tables / strikethrough.
  MarkdownPlugin.configure({ options: { remarkPlugins: [remarkGfm] } }),
]

// Skill files (and any markdown with leading YAML frontmatter) get the
// frontmatter pulled out and rendered as a static read-only table above the
// editable surface. Mirrors the AGENTS.md preamble pattern (PlateStatic + same
// plugin set). The raw frontmatter is preserved verbatim in `raw` and
// re-prepended on save, so the on-disk YAML stays byte-stable even though the
// editor only edits the body.
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const KEY_VALUE_RE = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/

interface ParsedFrontmatter {
  raw: string
  rows: { key: string; value: string }[]
  body: string
}

function splitFrontmatter(md: string): ParsedFrontmatter | null {
  const match = md.match(FRONTMATTER_RE)
  if (!match) return null
  const raw = match[0]
  const rows: { key: string; value: string }[] = []
  const lines = match[1].split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const kv = line.match(KEY_VALUE_RE)
    if (!kv) {
      i++
      continue
    }
    let value = kv[2]
    if (value.trim() === '') {
      // Nested block: gather indented continuation lines into a single cell.
      const block: string[] = []
      let j = i + 1
      while (j < lines.length && /^[ \t]/.test(lines[j])) {
        block.push(lines[j].trim())
        j++
      }
      value = block.join('; ')
      i = j
    } else {
      i++
    }
    let v = value.trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    }
    rows.push({ key: kv[1], value: v })
  }
  return { raw, rows, body: md.slice(raw.length) }
}

function frontmatterToTableMd(rows: { key: string; value: string }[]): string {
  if (rows.length === 0) return ''
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
  const lines = [
    '| Field | Value |',
    '| --- | --- |',
    ...rows.map(({ key, value }) => `| ${cell(key)} | ${cell(value)} |`),
  ]
  return lines.join('\n')
}

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

function Toolbar({
  statusLabel,
  onSave,
  saving,
  dirty,
}: {
  statusLabel: string
  onSave: () => void
  saving: boolean
  dirty: boolean
}) {
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
      <div className="ml-auto flex items-center gap-2 pr-1">
        <span className="text-[11px] text-muted-foreground">{statusLabel}</span>
        <Button size="sm" onClick={onSave} disabled={saving || !dirty}>
          <Save className="mr-1.5 size-3.5" />
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
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

  const frontmatter = useMemo(() => splitFrontmatter(initialMarkdown), [initialMarkdown])
  const initialBody = frontmatter?.body ?? initialMarkdown
  const frontmatterRaw = frontmatter?.raw ?? ''

  const editor = usePlateEditor(
    {
      plugins,
      value: (ed) => ed.getApi(MarkdownPlugin).markdown.deserialize(initialBody),
    },
    [path],
  )

  // Static read-only Plate editor that renders the frontmatter as a GFM
  // table. We deserialize a synthesized markdown table (rather than building
  // Slate nodes by hand) so the rendered look is byte-identical to body
  // tables produced by the same `MarkdownPlugin` + table elements.
  const frontmatterStatic = useMemo(() => {
    if (!frontmatter || frontmatter.rows.length === 0) return null
    return createSlateEditor({
      plugins,
      value: (ed) => ed.getApi(MarkdownPlugin).markdown.deserialize(frontmatterToTableMd(frontmatter.rows)) as Value,
    })
  }, [frontmatter])

  // Baseline is the editor's own round-tripped form. Comparing against the
  // raw `initialMarkdown` would mark every freshly-opened file dirty because
  // deserialize → serialize is not byte-identical (whitespace, table
  // normalisation, trailing newlines).
  const [baseline, setBaseline] = useState<string>(
    () => frontmatterRaw + editor.getApi(MarkdownPlugin).markdown.serialize(),
  )
  useEffect(() => {
    setBaseline(frontmatterRaw + editor.getApi(MarkdownPlugin).markdown.serialize())
  }, [editor, frontmatterRaw])

  return (
    <div className="flex h-full flex-col">
      <Plate editor={editor}>
        <EditorBody
          baseline={baseline}
          frontmatterRaw={frontmatterRaw}
          frontmatterStatic={frontmatterStatic}
          onSave={async (md) => {
            await write.mutateAsync({ path, content: md })
            setBaseline(md)
          }}
          saving={write.isPending}
          saveError={write.isError}
          saveSuccess={write.isSuccess}
        />
      </Plate>
    </div>
  )
}

function EditorBody({
  baseline,
  frontmatterRaw,
  frontmatterStatic,
  onSave,
  saving,
  saveError,
  saveSuccess,
}: {
  baseline: string
  frontmatterRaw: string
  frontmatterStatic: ReturnType<typeof createSlateEditor> | null
  onSave: (md: string) => Promise<void>
  saving: boolean
  saveError: boolean
  saveSuccess: boolean
}) {
  const editor = useEditorRef()
  const dirty = useEditorSelector(
    (ed) => {
      try {
        const current = frontmatterRaw + ed.getApi(MarkdownPlugin).markdown.serialize()
        return current !== baseline
      } catch {
        return false
      }
    },
    [baseline, frontmatterRaw],
  )

  const handleSave = () => {
    const md = frontmatterRaw + editor.getApi(MarkdownPlugin).markdown.serialize()
    void onSave(md)
  }

  const status = useMemo(() => {
    if (saving) return 'Saving…'
    if (saveError) return 'Save failed'
    if (saveSuccess && !dirty) return 'Saved'
    if (dirty) return 'Unsaved changes'
    return ''
  }, [saving, saveError, saveSuccess, dirty])

  return (
    <>
      <Toolbar statusLabel={status} onSave={handleSave} saving={saving} dirty={dirty} />
      <div className="flex-1 overflow-auto">
        {frontmatterStatic && (
          <div className="border-border border-b bg-muted/40 px-4 py-3">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
              <Lock className="size-3" />
              <span>Frontmatter — read-only</span>
            </div>
            <PlateStatic editor={frontmatterStatic} />
          </div>
        )}
        <PlateContent
          className="min-h-full px-4 py-3 text-sm leading-relaxed outline-none"
          placeholder="Start writing…"
        />
      </div>
    </>
  )
}
