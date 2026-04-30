import { parseDiffFromFile } from '@pierre/diffs'
import { FileDiff } from '@pierre/diffs/react'
import type { ChangePayload, JsonPatchOp } from '@vobase/core'
import { useMemo } from 'react'

import { pluralize } from '@/lib/format'
import { cn } from '@/lib/utils'

interface Props {
  payload: ChangePayload
  /** Optional resource id used as the file label inside the diff header. */
  resourceLabel?: string
  className?: string
}

export function DiffView({ payload, resourceLabel, className }: Props) {
  if (payload.kind === 'markdown_patch') {
    return <MarkdownPatchView payload={payload} resourceLabel={resourceLabel} className={className} />
  }
  if (payload.kind === 'field_set') {
    return <FieldSetView payload={payload} className={className} />
  }
  return <JsonPatchView payload={payload} className={className} />
}

function MarkdownPatchView({
  payload,
  resourceLabel,
  className,
}: {
  payload: Extract<ChangePayload, { kind: 'markdown_patch' }>
  resourceLabel?: string
  className?: string
}) {
  const fileName = resourceLabel?.endsWith('.md') ? resourceLabel : `${payload.field}.md`
  const lineCount = useMemo(() => payload.body.split('\n').length, [payload.body])
  // The proposal payload doesn't carry the prior body, so we synthesize a patch
  // against an empty before-state — both append and replace render as pure
  // additions. parseDiffFromFile auto-derives a combined cacheKey from old/new
  // cacheKeys, so the worker pool reuses highlighting across re-renders.
  const fileDiff = useMemo(
    () =>
      parseDiffFromFile(
        { name: fileName, contents: '', cacheKey: `${fileName}:empty` },
        { name: fileName, contents: payload.body, cacheKey: `${fileName}:${payload.body.length}` },
        { context: 3 },
      ),
    [fileName, payload.body],
  )

  return (
    <div className={cn('overflow-hidden rounded-md border border-border bg-card', className)}>
      <div className="flex items-center gap-2 border-border border-b bg-muted/30 px-3 py-1.5 text-xs">
        <span className="rounded bg-success/15 px-1.5 py-0.5 font-medium text-[10px] text-success uppercase tracking-wide">
          {payload.mode}
        </span>
        <span className="font-mono text-muted-foreground">{fileName}</span>
        <span className="ml-auto text-muted-foreground">{pluralize(lineCount, 'line')}</span>
      </div>
      <div className="max-h-[480px] overflow-auto bg-background">
        <FileDiff
          fileDiff={fileDiff}
          options={{
            diffStyle: 'unified',
            diffIndicators: 'classic',
            disableFileHeader: true,
            theme: { light: 'pierre-light', dark: 'pierre-dark' },
            themeType: 'system',
          }}
        />
      </div>
    </div>
  )
}

function FieldSetView({
  payload,
  className,
}: {
  payload: Extract<ChangePayload, { kind: 'field_set' }>
  className?: string
}) {
  const fields = Object.entries(payload.fields)
  if (fields.length === 0) {
    return <p className={cn('text-muted-foreground text-xs italic', className)}>No fields changed</p>
  }
  return (
    <div className={cn('overflow-hidden rounded-md border border-border bg-card', className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-border border-b bg-muted/30 text-left text-muted-foreground text-xs">
            <th className="px-3 py-2 font-medium">Field</th>
            <th className="px-3 py-2 font-medium">From</th>
            <th className="px-3 py-2 font-medium">To</th>
          </tr>
        </thead>
        <tbody>
          {fields.map(([key, change]) => (
            <tr key={key} className="border-border border-b last:border-0">
              <td className="px-3 py-2 align-top font-mono text-foreground text-xs">{key}</td>
              <td className="px-3 py-2 align-top">
                <ValueCell value={change.from} kind="from" />
              </td>
              <td className="px-3 py-2 align-top">
                <ValueCell value={change.to} kind="to" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ValueCell({ value, kind }: { value: unknown; kind: 'from' | 'to' }) {
  const tone = kind === 'from' ? 'text-muted-foreground line-through' : 'text-success'
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground/60 text-xs italic">empty</span>
  }
  if (typeof value === 'boolean') {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] uppercase',
          value ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
          kind === 'from' && 'opacity-60',
        )}
      >
        {String(value)}
      </span>
    )
  }
  const display = typeof value === 'string' ? value : JSON.stringify(value)
  return <span className={cn('break-words font-mono text-xs', tone)}>{display}</span>
}

function JsonPatchView({
  payload,
  className,
}: {
  payload: Extract<ChangePayload, { kind: 'json_patch' }>
  className?: string
}) {
  if (payload.ops.length === 0) {
    return <p className={cn('text-muted-foreground text-xs italic', className)}>No ops</p>
  }
  return (
    <ol className={cn('space-y-1.5 rounded-md border border-border bg-card p-3 text-sm', className)}>
      {payload.ops.map((op, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: ops are an ordered list with no stable id
        <li key={i} className="flex flex-wrap items-baseline gap-2 font-mono text-xs">
          <span className={cn('rounded px-1.5 py-0.5 font-semibold uppercase', opKindClass(op))}>{op.op}</span>
          <span className="text-foreground">{op.path}</span>
          {opValue(op)}
        </li>
      ))}
    </ol>
  )
}

function opKindClass(op: JsonPatchOp): string {
  if (op.op === 'add') return 'bg-success/10 text-success'
  if (op.op === 'remove') return 'bg-destructive/10 text-destructive'
  if (op.op === 'replace') return 'bg-warning/10 text-warning'
  return 'bg-info/10 text-info'
}

function opValue(op: JsonPatchOp): React.ReactNode {
  if (op.op === 'remove') return null
  if (op.op === 'move' || op.op === 'copy') return <span className="text-muted-foreground">{`from ${op.from}`}</span>
  return <span className="text-muted-foreground">{JSON.stringify(op.value)}</span>
}
