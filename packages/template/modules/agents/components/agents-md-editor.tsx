/**
 * AgentsMdEditor — composite `AGENTS.md` view for an agent. The auto-generated
 * framework preamble renders as a **sibling above** the editable Plate surface
 * (not as a void node inside it) because two Slate trees in one `PlateContent`
 * subtree confuses `toSlateNode` during selection resolution and crashes the
 * editor. Sharing the scroll container still makes the two halves scroll as
 * one document, and both render through the same `contentPlugins` so the
 * typography is byte-identical.
 *
 * Save serialises `editor.children` back to markdown and writes via
 * `useUpdateAgent`; the drive's `/AGENTS.md` query is invalidated on success
 * so the browser preview reflects the new content.
 */

import { LANE_PREVIEW_VARIANTS, useAgentsMd, useUpdateAgent } from '@modules/agents/hooks/use-agent-definitions'
import { type DriveScopeArg, driveKeys } from '@modules/drive/hooks/use-drive'
import {
  BasicBlocksPlugin,
  BasicMarksPlugin,
  BlockquotePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
} from '@platejs/basic-nodes/react'
import { MarkdownPlugin } from '@platejs/markdown'
import { TableCellHeaderPlugin, TableCellPlugin, TablePlugin, TableRowPlugin } from '@platejs/table/react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Bold,
  ChevronDown,
  ChevronUp,
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
  useEditorRef,
  useEditorSelector,
  usePlateEditor,
} from 'platejs/react'
import { PlateStatic } from 'platejs/static'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import remarkGfm from 'remark-gfm'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

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
// Plate has no element registered for those types. The `Memory scopes` table
// in the auto-generated preamble is the most visible casualty.
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

// Do NOT add `remarkMdx` to the remark pipeline: it parses `<id>` / `<file>` /
// `<2k` style tokens from the AGENTS.md as JSX components and silently
// truncates the document at the first one, leaving every lane variant
// rendering the same first ~2KB of nodes.
const contentPlugins = [
  BasicBlocksPlugin,
  BasicMarksPlugin,
  H1Plugin.withComponent(H1Element),
  H2Plugin.withComponent(H2Element),
  H3Plugin.withComponent(H3Element),
  BlockquotePlugin.withComponent(BlockquoteElement),
  TablePlugin.withComponent(TableElement),
  TableRowPlugin.withComponent(TableRowElement),
  TableCellPlugin.withComponent(TableCellElement),
  TableCellHeaderPlugin.withComponent(TableCellHeaderElement),
  MarkdownPlugin.configure({ options: { remarkPlugins: [remarkGfm] } }),
]

function PreambleView({
  preamble,
  variantId,
  onVariantChange,
}: {
  preamble: string
  variantId: string
  onVariantChange: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const editor = useMemo(
    () =>
      createSlateEditor({
        plugins: contentPlugins,
        value: (ed) => ed.getApi(MarkdownPlugin).markdown.deserialize(preamble) as Value,
      }),
    [preamble],
  )
  return (
    <div className="border-border border-b bg-muted px-4 py-3 text-muted-foreground text-sm leading-relaxed">
      <div className="mb-2 flex items-center gap-2 font-medium text-[11px] uppercase tracking-wide">
        <Lock className="size-3" />
        <span>Auto-generated preamble — read-only</span>
        <Select value={variantId} onValueChange={onVariantChange}>
          <SelectTrigger className="ml-auto h-6 w-auto gap-1 border-border/60 bg-background/60 px-2 py-0 font-normal text-[11px] normal-case tracking-normal">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {LANE_PREVIEW_VARIANTS.map((v) => (
              <SelectItem key={v.id} value={v.id} className="text-xs">
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="relative">
        <div
          className={cn('transition-[max-height] duration-300 ease-out', expanded ? '' : 'max-h-48 overflow-hidden')}
        >
          <PlateStatic editor={editor} />
        </div>
        {!expanded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-muted to-transparent" />
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setExpanded((v) => !v)}
        className="mt-1 h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {expanded ? (
          <>
            <ChevronUp className="size-3" />
            Show less
          </>
        ) : (
          <>
            <ChevronDown className="size-3" />
            Show more
          </>
        )}
      </Button>
    </div>
  )
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

export interface AgentsMdEditorProps {
  agentId: string
  agentName: string
  initialInstructions: string
}

export function AgentsMdEditor({ agentId, agentName, initialInstructions }: AgentsMdEditorProps) {
  const [variantId, setVariantId] = useState<string>(LANE_PREVIEW_VARIANTS[0].id)
  const variant = LANE_PREVIEW_VARIANTS.find((v) => v.id === variantId) ?? LANE_PREVIEW_VARIANTS[0]
  const { data: md } = useAgentsMd(agentId, variant.query)
  const update = useUpdateAgent(agentId)
  const qc = useQueryClient()
  const preamble = md?.preamble ?? `# ${agentName} (${agentId})\n\n_Loading preamble…_\n`

  const editor = usePlateEditor(
    {
      plugins: contentPlugins,
      value: (ed) =>
        ed.getApi(MarkdownPlugin).markdown.deserialize(initialInstructions || '_No instructions yet._') as Value,
    },
    [agentId],
  )

  // Baseline is the editor's own round-tripped form. Comparing against the
  // raw `initialInstructions` prop falsely marks an untouched page dirty
  // because deserialize → serialize is not byte-identical (whitespace, table
  // normalisation, trailing newlines).
  const [baseline, setBaseline] = useState<string>(() =>
    editor.getApi(MarkdownPlugin).markdown.serialize({ value: editor.children as Value }),
  )
  useEffect(() => {
    setBaseline(editor.getApi(MarkdownPlugin).markdown.serialize({ value: editor.children as Value }))
  }, [editor])

  // Drive cache invalidator — `/AGENTS.md` is a virtual file backed by
  // `agent_definitions.instructions`; saving through `useUpdateAgent` must
  // also refresh the drive's per-file cache so the DriveBrowser preview
  // reflects the new content on next mount.
  const agentScope: DriveScopeArg = { scope: 'agent', agentId }
  const invalidateDriveFile = () => {
    qc.invalidateQueries({ queryKey: driveKeys.file(agentScope, '/AGENTS.md') })
  }

  return (
    <div className="flex h-full flex-col">
      <Plate editor={editor}>
        <EditorBody
          preamble={preamble}
          variantId={variantId}
          onVariantChange={setVariantId}
          baseline={baseline}
          update={update}
          onSaved={(md) => {
            setBaseline(md)
            invalidateDriveFile()
          }}
        />
      </Plate>
    </div>
  )
}

/**
 * Inner body rendered inside `<Plate>`. All hooks that read editor state via
 * `useEditorRef` / `useEditorSelector` must live below the Plate provider —
 * calling them from `AgentsMdEditor` throws "Plate hooks must be used inside
 * a Plate or PlateController".
 */
function EditorBody({
  preamble,
  variantId,
  onVariantChange,
  baseline,
  update,
  onSaved,
}: {
  preamble: string
  variantId: string
  onVariantChange: (id: string) => void
  baseline: string
  update: ReturnType<typeof useUpdateAgent>
  onSaved: (md: string) => void
}) {
  const editor = useEditorRef()
  const dirty = useEditorSelector(
    (ed) => {
      try {
        const current = ed.getApi(MarkdownPlugin).markdown.serialize({ value: ed.children as Value })
        return current !== baseline
      } catch {
        return false
      }
    },
    [baseline],
  )

  const handleSave = () => {
    const md = editor.getApi(MarkdownPlugin).markdown.serialize({ value: editor.children as Value })
    update.mutate({ instructions: md }, { onSuccess: () => onSaved(md) })
  }

  const status = useMemo(() => {
    if (update.isPending) return 'Saving…'
    if (update.isError) return 'Save failed'
    if (update.isSuccess && !dirty) return 'Saved'
    if (dirty) return 'Unsaved changes'
    return ''
  }, [update.isPending, update.isError, update.isSuccess, dirty])

  return (
    <>
      <Toolbar statusLabel={status} onSave={handleSave} saving={update.isPending} dirty={dirty} />
      <div className="flex-1 overflow-auto">
        <PreambleView preamble={preamble} variantId={variantId} onVariantChange={onVariantChange} />
        <PlateContent
          className="min-h-full px-4 py-3 text-sm leading-relaxed outline-none"
          placeholder="Describe how this agent should behave…"
        />
      </div>
    </>
  )
}
