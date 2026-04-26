/**
 * Output formatter for `@vobase/cli`.
 *
 * Verbs declare a `formatHint` in the catalog which the CLI's generic
 * renderer interprets:
 *
 *   - `'table:cols=id,displayName,phone'` — column-aligned table; rows must
 *     be `Array<Record<string, unknown>>`. Date-shaped values render
 *     relatively (e.g. `2 hours ago`).
 *   - `'json'` — pretty-printed JSON.
 *   - `'lines:field=path'` — one line per array element from the named
 *     field (good for `vobase drive ls`).
 *   - omitted: generic-object pretty-print + generic-array count summary.
 *
 * `--json` (forwarded as `format: 'json'`) overrides any hint and emits
 * raw JSON regardless. This is the contract for shell pipelines.
 */

export type Format = 'human' | 'json'

export interface FormatOpts {
  format: Format
  hint?: string
}

export function formatResult(value: unknown, opts: FormatOpts): string {
  if (opts.format === 'json') return jsonPretty(value)
  return formatHuman(value, opts.hint)
}

function formatHuman(value: unknown, hint?: string): string {
  if (hint && hint.length > 0) {
    const parsed = parseHint(hint)
    if (parsed) return renderHinted(value, parsed)
  }
  // Fallback: generic pretty-print with array summary.
  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? '' : 's'}\n${jsonPretty(value)}`
  }
  return jsonPretty(value)
}

interface HintTable {
  kind: 'table'
  cols: readonly string[]
}
interface HintJson {
  kind: 'json'
}
interface HintLines {
  kind: 'lines'
  field: string
}
type ParsedHint = HintTable | HintJson | HintLines

function parseHint(hint: string): ParsedHint | null {
  const trimmed = hint.trim()
  if (trimmed === 'json') return { kind: 'json' }
  if (trimmed.startsWith('table:')) {
    const params = parseHintParams(trimmed.slice('table:'.length))
    const cols = params.cols
      ? params.cols
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean)
      : []
    if (cols.length === 0) return null
    return { kind: 'table', cols }
  }
  if (trimmed.startsWith('lines:')) {
    const params = parseHintParams(trimmed.slice('lines:'.length))
    if (!params.field) return null
    return { kind: 'lines', field: params.field }
  }
  return null
}

function parseHintParams(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of s.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
  }
  return out
}

function renderHinted(value: unknown, hint: ParsedHint): string {
  if (hint.kind === 'json') return jsonPretty(value)
  if (hint.kind === 'table') return renderTable(value, hint.cols)
  return renderLines(value, hint.field)
}

function renderTable(value: unknown, cols: readonly string[]): string {
  if (!Array.isArray(value)) return jsonPretty(value)
  if (value.length === 0) return '(no rows)\n'
  const rows = value as readonly Record<string, unknown>[]
  const header = cols.map((c) => c.toUpperCase())
  const cells: string[][] = [header]
  for (const row of rows) {
    cells.push(cols.map((c) => stringifyCell(row[c])))
  }
  const widths = cols.map((_, i) => Math.max(...cells.map((r) => r[i].length)))
  const lines: string[] = []
  for (const r of cells) {
    lines.push(
      r
        .map((c, i) => c.padEnd(widths[i], ' '))
        .join('  ')
        .trimEnd(),
    )
  }
  // Insert a separator under the header.
  lines.splice(
    1,
    0,
    widths
      .map((w) => '-'.repeat(w))
      .join('  ')
      .trimEnd(),
  )
  return `${lines.join('\n')}\n`
}

function renderLines(value: unknown, field: string): string {
  if (!Array.isArray(value)) return jsonPretty(value)
  if (value.length === 0) return '(no items)\n'
  return `${value.map((row) => stringifyCell((row as Record<string, unknown>)[field])).join('\n')}\n`
}

function stringifyCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') {
    if (isLikelyDateString(v)) return formatRelative(new Date(v))
    return v
  }
  if (v instanceof Date) return formatRelative(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

function isLikelyDateString(s: string): boolean {
  return ISO_DATE_RE.test(s) && !Number.isNaN(Date.parse(s))
}

const SECOND = 1_000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatRelative(date: Date, now: Date = new Date()): string {
  const diff = now.getTime() - date.getTime()
  const abs = Math.abs(diff)
  const future = diff < 0
  const phrase = (n: number, unit: string): string => {
    const plural = n === 1 ? unit : `${unit}s`
    return future ? `in ${n} ${plural}` : `${n} ${plural} ago`
  }
  if (abs < MINUTE) return future ? 'in a moment' : 'just now'
  if (abs < HOUR) return phrase(Math.floor(abs / MINUTE), 'minute')
  if (abs < DAY) return phrase(Math.floor(abs / HOUR), 'hour')
  if (abs < 30 * DAY) return phrase(Math.floor(abs / DAY), 'day')
  return date.toISOString().slice(0, 10)
}

function jsonPretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}
