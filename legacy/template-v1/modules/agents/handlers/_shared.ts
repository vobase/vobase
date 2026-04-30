import { z } from 'zod'

/** Safely parse a JSON text column, returning fallback on failure. */
function _safeJsonParse(value: string | null, fallback: unknown = null): unknown {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

export const scopeSchema = z.union([
  z.string().regex(/^contact:.+/, 'Scope must be contact:ID or user:ID'),
  z.string().regex(/^user:.+/, 'Scope must be contact:ID or user:ID'),
])

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

/** Parse a composite cursor of format `timestamp_id` for correct keyset pagination. */
export function parseCursor(cursor: string): { ts: Date; id: string } | null {
  const sep = cursor.indexOf('_')
  if (sep === -1) return null
  const ts = new Date(cursor.slice(0, sep))
  const id = cursor.slice(sep + 1)
  if (Number.isNaN(ts.getTime()) || !id) return null
  return { ts, id }
}

/** Build a composite cursor string from a row's createdAt + id. */
export function buildCursor(row: { createdAt: Date; id: string }): string {
  return `${row.createdAt.toISOString()}_${row.id}`
}
