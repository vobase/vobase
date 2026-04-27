import type { ChangePayload, JsonPatchOp } from '@vobase/core'
import { createTwoFilesPatch } from 'diff'

import { cn } from '@/lib/utils'

interface Props {
  payload: ChangePayload
  className?: string
}

export function DiffView({ payload, className }: Props) {
  if (payload.kind === 'markdown_patch') {
    return <MarkdownPatchView payload={payload} className={className} />
  }
  if (payload.kind === 'field_set') {
    return <FieldSetView payload={payload} className={className} />
  }
  return <JsonPatchView payload={payload} className={className} />
}

// ─── markdown_patch ─────────────────────────────────────────────────────────

function MarkdownPatchView({
  payload,
  className,
}: {
  payload: Extract<ChangePayload, { kind: 'markdown_patch' }>
  className?: string
}) {
  if (payload.mode === 'append') {
    // Append-mode: show only the appended chunk, prefixed with `+`.
    const lines = payload.body.split('\n')
    return (
      <pre
        className={cn(
          'whitespace-pre-wrap rounded border border-success/20 bg-success/5 p-2 font-mono text-xs',
          className,
        )}
      >
        <span className="text-muted-foreground">{`Append to ${payload.field}:\n`}</span>
        {lines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: append chunk lines are positionally stable
          <span key={i} className="text-success">{`+ ${line}\n`}</span>
        ))}
      </pre>
    )
  }

  // Replace-mode: render a unified-diff against an empty before-state.
  // The proposal payload doesn't carry the prior body — UI consumers compute
  // the patch from the live resource if they want a true before/after diff.
  // For now, treat replace as "set field to body" with a header.
  const patch = createTwoFilesPatch(payload.field, payload.field, '', payload.body, 'before', 'after')
  return (
    <pre
      className={cn('whitespace-pre-wrap rounded border border-border bg-muted/30 p-2 font-mono text-xs', className)}
    >
      {patch.split('\n').map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: patch lines are positionally stable
        <span key={i} className={lineClass(line)}>{`${line}\n`}</span>
      ))}
    </pre>
  )
}

function lineClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'text-success'
  if (line.startsWith('-') && !line.startsWith('---')) return 'text-destructive'
  if (line.startsWith('@@')) return 'text-info font-semibold'
  return 'text-muted-foreground'
}

// ─── field_set ──────────────────────────────────────────────────────────────

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
    <table className={cn('w-full text-xs', className)}>
      <thead>
        <tr className="border-border border-b text-left text-muted-foreground">
          <th className="px-2 py-1 font-medium">Field</th>
          <th className="px-2 py-1 font-medium">From</th>
          <th className="px-2 py-1 font-medium">To</th>
        </tr>
      </thead>
      <tbody>
        {fields.map(([key, change]) => (
          <tr key={key} className="border-border border-b last:border-0">
            <td className="px-2 py-1.5 font-mono">{key}</td>
            <td className="px-2 py-1.5 font-mono text-muted-foreground line-through">{renderValue(change.from)}</td>
            <td className="px-2 py-1.5 font-mono text-success">{renderValue(change.to)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '∅'
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

// ─── json_patch ─────────────────────────────────────────────────────────────

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
    <ol className={cn('space-y-1 text-xs', className)}>
      {payload.ops.map((op, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: ops are an ordered list with no stable id
        <li key={i} className="flex gap-2 font-mono">
          <span className={opKindClass(op)}>{op.op}</span>
          <span className="text-muted-foreground">{op.path}</span>
          {opValue(op)}
        </li>
      ))}
    </ol>
  )
}

function opKindClass(op: JsonPatchOp): string {
  if (op.op === 'add') return 'text-success font-semibold'
  if (op.op === 'remove') return 'text-destructive font-semibold'
  if (op.op === 'replace') return 'text-warning font-semibold'
  return 'text-info font-semibold'
}

function opValue(op: JsonPatchOp): React.ReactNode {
  if (op.op === 'remove') return null
  if (op.op === 'move' || op.op === 'copy') return <span className="text-muted-foreground">{`from ${op.from}`}</span>
  return <span className="truncate">{JSON.stringify(op.value)}</span>
}
