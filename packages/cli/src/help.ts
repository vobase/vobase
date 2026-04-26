/**
 * Help generator for `@vobase/cli`.
 *
 * Help is generated from the catalog so the same binary serves every
 * tenant's verb set without rebuilding. Two scopes:
 *
 *   - `vobase --help` — global help: all verb groups + their descriptions
 *   - `vobase <group> --help` — per-group help: group-prefixed verbs with
 *     their input schemas summarized as `--key=<type>` pairs
 */

import type { Catalog, CatalogVerb } from './catalog'

const HEADER = `vobase — catalog-driven CLI for any vobase deployment

Usage: vobase [global-flags] <verb> [args...]

Global flags:
  --config <name>      Use ~/.vobase/<name>.json (default: 'config'); also VOBASE_CONFIG
  --json               Output raw JSON instead of human-readable format
  --refresh            Force-refetch the verb catalog
  --help               Show this help

`

export function renderGlobalHelp(catalog: Catalog): string {
  if (catalog.verbs.length === 0) {
    return `${HEADER}No verbs available. Run 'vobase --refresh' or check 'vobase auth whoami' to verify connectivity.\n`
  }
  const groups = groupByLeadingToken(catalog.verbs)
  const lines = [HEADER, 'Verb groups:']
  const widest = Math.max(...[...groups.keys()].map((k) => k.length))
  for (const [group, verbs] of groups) {
    const sample = verbs.length === 1 ? verbs[0].description : `${verbs.length} verbs`
    lines.push(`  ${group.padEnd(widest, ' ')}  ${sample}`)
  }
  lines.push('')
  lines.push("Run 'vobase <group> --help' for verbs in a group.")
  lines.push("Run 'vobase --refresh' to refresh the verb catalog from your tenant.")
  return `${lines.join('\n')}\n`
}

export function renderGroupHelp(catalog: Catalog, group: string): string {
  const verbs = catalog.verbs.filter((v) => v.name === group || v.name.startsWith(`${group} `))
  if (verbs.length === 0) {
    return `vobase: no verbs found for group '${group}'. Run 'vobase --help' to list groups.\n`
  }
  const lines = [`Verbs in '${group}':`, '']
  for (const verb of verbs) {
    lines.push(`  vobase ${verb.name}`)
    if (verb.description) lines.push(`    ${verb.description}`)
    const flags = summarizeInputSchema(verb)
    if (flags) lines.push(`    ${flags}`)
    lines.push('')
  }
  return lines.join('\n')
}

function groupByLeadingToken(verbs: readonly CatalogVerb[]): Map<string, readonly CatalogVerb[]> {
  const out = new Map<string, CatalogVerb[]>()
  for (const verb of verbs) {
    const head = verb.name.split(/\s+/u)[0]
    const list = out.get(head) ?? []
    list.push(verb)
    out.set(head, list)
  }
  return new Map([...out.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

function summarizeInputSchema(verb: CatalogVerb): string {
  const schema = verb.inputSchema
  if (!schema || typeof schema !== 'object') return ''
  const obj = schema as { properties?: Record<string, { type?: string; description?: string }>; required?: string[] }
  if (!obj.properties || Object.keys(obj.properties).length === 0) return ''
  const required = new Set(obj.required ?? [])
  const parts: string[] = []
  for (const [key, prop] of Object.entries(obj.properties)) {
    const type = prop.type ?? 'value'
    parts.push(required.has(key) ? `--${key}=<${type}>` : `[--${key}=<${type}>]`)
  }
  return parts.join(' ')
}
