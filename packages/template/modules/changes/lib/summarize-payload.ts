import type { ChangePayload } from '@vobase/core'

import { pluralize } from '@/lib/format'

/** One-sentence human-readable summary for a `ChangePayload`. Lives in the
 *  module (not the UI layer) so non-UI callers — CLI verb formatters, agent
 *  tool result summaries — can reuse the same wording. */
export function summarizePayload(payload: ChangePayload): string {
  if (payload.kind === 'markdown_patch') {
    const lines = payload.body.split('\n').length
    const verb = payload.mode === 'append' ? 'Append' : 'Replace'
    const target = payload.mode === 'append' ? `to ${payload.field}` : `${payload.field} with`
    return `${verb} ${pluralize(lines, 'line')} ${target}${payload.mode === 'replace' ? ' of new content' : ''}.`
  }
  if (payload.kind === 'field_set') {
    const keys = Object.keys(payload.fields)
    if (keys.length === 1) return `Update field “${keys[0]}”.`
    if (keys.length <= 3) return `Update fields ${keys.map((k) => `“${k}”`).join(', ')}.`
    return `Update ${pluralize(keys.length, 'field')}.`
  }
  const ops = payload.ops
  if (ops.length === 1) {
    const o = ops[0]
    if (!o) return 'Apply 1 patch operation.'
    return `${capitalize(o.op)} ${o.path}.`
  }
  return `Apply ${pluralize(ops.length, 'patch operation')}.`
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)
}
