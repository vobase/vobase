/**
 * Submit all Vobase Meta WhatsApp templates to a target WABA.
 *
 * Operator script — run against the platform's WABA whenever:
 *   - A new template is added to `meta-template-definitions.ts`
 *   - An existing template's `_vN` suffix is bumped (new version)
 *
 * Wire-shapes are imported from `meta-template-definitions.ts` — the same
 * payloads the runtime senders dispatch — so this script and the dispatcher
 * cannot drift.
 *
 * Existing approved templates (matched by name + language) are skipped.
 * Meta rejects duplicate-name submissions, and editing approved templates
 * in-place is out of scope: when copy needs to change, bump the `_vN`.
 *
 * Required env:
 *   META_WA_ACCESS_TOKEN         System User token with `whatsapp_business_management` scope
 *   META_WA_BUSINESS_ACCOUNT_ID  Target WABA ID (platform's WABA)
 *
 * Optional env / flags:
 *   META_TEMPLATE_DOMAIN, --domain=<host>   Platform host substituted into the
 *                                            BUTTON URL (`https://<host>/{{1}}`).
 *                                            Defaults to `platform.vobase.dev`.
 *                                            Use this for private deployments
 *                                            (e.g. `platform.voltade.app`).
 *
 * Usage (from packages/template):
 *   bun run scripts/submit-meta-templates.ts                              # default domain
 *   bun run scripts/submit-meta-templates.ts --dry-run                    # no Meta calls
 *   bun run scripts/submit-meta-templates.ts --domain=platform.voltade.app
 *   META_TEMPLATE_DOMAIN=platform.voltade.app bun run scripts/submit-meta-templates.ts
 */

import {
  buildMetaTemplateDefinitions,
  DEFAULT_PLATFORM_DOMAIN,
  type MetaTemplatePayload,
} from '../modules/integrations/service/meta-template-definitions'

const META_GRAPH_VERSION = 'v21.0'
const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`

const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

const dryRun = process.argv.includes('--dry-run')
const domainFlag = process.argv.find((a) => a.startsWith('--domain='))?.slice('--domain='.length)
const domain = domainFlag || process.env.META_TEMPLATE_DOMAIN || DEFAULT_PLATFORM_DOMAIN

const accessToken = process.env.META_WA_ACCESS_TOKEN
const wabaId = process.env.META_WA_BUSINESS_ACCOUNT_ID

if (!accessToken || !wabaId) {
  console.error(red('error:'), 'missing META_WA_ACCESS_TOKEN or META_WA_BUSINESS_ACCOUNT_ID env vars')
  process.exit(1)
}

const templates = buildMetaTemplateDefinitions(domain)

interface ListedTemplate {
  name: string
  status: string
  language: string
  category: string
}

async function fetchExistingTemplates(): Promise<ListedTemplate[]> {
  const all: ListedTemplate[] = []
  let url: string | null =
    `${META_GRAPH_BASE}/${wabaId}/message_templates?fields=name,status,language,category&limit=100`
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Meta list templates failed (${res.status}): ${body.slice(0, 400)}`)
    }
    const json = (await res.json()) as { data: ListedTemplate[]; paging?: { next?: string } }
    all.push(...json.data)
    url = json.paging?.next ?? null
  }
  return all
}

async function submitTemplate(t: MetaTemplatePayload): Promise<{ id: string; status: string }> {
  const res = await fetch(`${META_GRAPH_BASE}/${wabaId}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(t),
  })
  const json = (await res.json()) as { id?: string; status?: string; error?: { message: string; code: number } }
  if (!res.ok || json.error) {
    const msg = json.error?.message ?? `HTTP ${res.status}`
    throw new Error(msg)
  }
  return { id: json.id ?? '', status: json.status ?? 'unknown' }
}

console.log(dim(`Meta Graph ${META_GRAPH_VERSION} · WABA ${wabaId} · domain ${domain}`))
console.log(dim(dryRun ? '[dry-run]' : '[live]'))
console.log()

let existing: ListedTemplate[] = []
if (!dryRun) {
  try {
    existing = await fetchExistingTemplates()
    console.log(dim(`Found ${existing.length} existing templates on WABA`))
    console.log()
  } catch (err) {
    console.error(red('error:'), `failed to list existing templates: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
}

const results: { name: string; outcome: 'created' | 'skipped' | 'failed'; detail: string }[] = []

for (const t of templates) {
  const already = existing.find((e) => e.name === t.name && e.language === t.language)
  if (already) {
    console.log(yellow('skip   '), t.name, dim(`(${already.status})`))
    results.push({ name: t.name, outcome: 'skipped', detail: already.status })
    continue
  }

  if (dryRun) {
    console.log(green('would create'), t.name)
    console.log(dim(JSON.stringify(t, null, 2)))
    console.log()
    results.push({ name: t.name, outcome: 'created', detail: 'dry-run' })
    continue
  }

  try {
    const created = await submitTemplate(t)
    console.log(green('create '), t.name, dim(`(${created.status})  id=${created.id}`))
    results.push({ name: t.name, outcome: 'created', detail: created.status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(red('fail   '), t.name, dim(msg))
    results.push({ name: t.name, outcome: 'failed', detail: msg })
  }
}

console.log()
const created = results.filter((r) => r.outcome === 'created').length
const skipped = results.filter((r) => r.outcome === 'skipped').length
const failed = results.filter((r) => r.outcome === 'failed').length
console.log(dim(`${created} created · ${skipped} skipped · ${failed} failed`))

if (failed > 0) process.exit(1)
