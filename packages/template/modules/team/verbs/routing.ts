/**
 * `vobase routing …` — admin verbs for the lead-routing rule table.
 *
 *   routing list      — show every rule
 *   routing set       — create / replace a rule
 *   routing rm        — delete a rule by id
 *   routing simulate  — dry-run the matcher for a hypothetical inquiry
 *   routing check     — validate rules (reps resolve, no orphan pools)
 *
 * Routing config is reviewed quarterly against the segregation sheet; these
 * verbs are the operator's seam for that review. Admin-tier — they mutate
 * tenant config.
 */

import { lastOwnerAssignedAt } from '@modules/messaging/service/conversations'
import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

import type { RoutingRule, RoutingRuleKind } from '../schema'
import { listRoutingRules, removeRoutingRule, routeLead, upsertRoutingRule } from '../service/lead-routing'
import { list as listStaff, resolveStaffRef } from '../service/staff'

function formatRule(r: RoutingRule, name: (id: string | null) => string): string {
  if (r.kind === 'exclusive') return `  ${r.id}  exclusive  "${r.keyword}" → ${name(r.repUserId)}`
  if (r.kind === 'pool_keyword') return `  ${r.id}  pool_keyword  "${r.keyword}" → pool:${r.pool}`
  return `  ${r.id}  pool_member  pool:${r.pool} → ${name(r.repUserId)}`
}

export const routingListVerb = defineCliVerb({
  name: 'routing list',
  description: 'List every lead-routing rule (exclusive accounts, keyword pools, pool members).',
  readOnly: true,
  input: z.object({}),
  body: async ({ ctx }) => {
    const [rules, staff] = await Promise.all([listRoutingRules(ctx.organizationId), listStaff(ctx.organizationId)])
    const byId = new Map(staff.map((s) => [s.userId, s.displayName ?? s.userId]))
    const name = (id: string | null) => (id ? `user:${id} (${byId.get(id) ?? '?'})` : '(none)')
    if (rules.length === 0) {
      return { ok: true as const, data: { rules: [] }, summary: 'No routing rules configured.' }
    }
    return {
      ok: true as const,
      data: { rules },
      summary: [`Routing rules (${rules.length}):`, ...rules.map((r) => formatRule(r, name))].join('\n'),
    }
  },
  formatHint: 'json',
})

export const routingSetVerb = defineCliVerb({
  name: 'routing set',
  description:
    'Create or replace a routing rule. exclusive: --keyword + --rep. pool_keyword: --keyword + --pool. pool_member: --pool + --rep.',
  usage:
    'vobase routing set --kind=<exclusive|pool_keyword|pool_member> [--keyword=<kw>] [--pool=<name>] [--rep=<user:id>] [--priority=<n>]',
  input: z.object({
    kind: z.enum(['exclusive', 'pool_keyword', 'pool_member']),
    keyword: z.string().trim().min(1).max(120).optional(),
    pool: z.string().trim().min(1).max(64).optional(),
    rep: z.string().trim().min(1).optional(),
    priority: z.number().int().min(0).max(1000).optional(),
  }),
  body: async ({ input, ctx }) => {
    const REQUIRED: Record<RoutingRuleKind, Array<'keyword' | 'pool' | 'rep'>> = {
      exclusive: ['keyword', 'rep'],
      pool_keyword: ['keyword', 'pool'],
      pool_member: ['pool', 'rep'],
    }
    const missing = REQUIRED[input.kind].filter((f) => !input[f])
    if (missing.length > 0) {
      return {
        ok: false as const,
        error: `${input.kind} rules need ${REQUIRED[input.kind].map((f) => `--${f}`).join(' and ')}`,
        errorCode: 'invalid_input' as const,
      }
    }

    // Resolve --rep against the staff roster so a typo is rejected up front.
    let repUserId: string | null = null
    if (input.rep) {
      try {
        repUserId = (await resolveStaffRef(ctx.organizationId, input.rep)).userId
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
          errorCode: 'invalid_input' as const,
        }
      }
    }

    const rule = await upsertRoutingRule({
      organizationId: ctx.organizationId,
      kind: input.kind,
      keyword: input.kind === 'pool_member' ? null : (input.keyword?.toLowerCase() ?? null),
      pool: input.kind === 'exclusive' ? null : (input.pool ?? null),
      repUserId,
      priority: input.priority,
    })
    return { ok: true as const, data: { rule }, summary: `Saved routing rule ${rule.id} (${rule.kind}).` }
  },
  formatHint: 'json',
})

export const routingRmVerb = defineCliVerb({
  name: 'routing rm',
  description: 'Delete a routing rule by id (see `routing list`).',
  usage: 'vobase routing rm --id=<ruleId>',
  input: z.object({ id: z.string().min(1) }),
  body: async ({ ctx, input }) => {
    await removeRoutingRule(ctx.organizationId, input.id)
    return { ok: true as const, data: { id: input.id }, summary: `Deleted routing rule ${input.id}.` }
  },
  formatHint: 'json',
})

export const routingSimulateVerb = defineCliVerb({
  name: 'routing simulate',
  description: 'Dry-run the lead matcher for a hypothetical inquiry — shows who it would route to and why.',
  usage: 'vobase routing simulate --type=<corporate|private> [--company=<name>] [--industry=<sector>]',
  readOnly: true,
  input: z.object({
    type: z.enum(['corporate', 'private']),
    company: z.string().trim().max(200).optional(),
    industry: z.string().trim().max(200).optional(),
  }),
  body: async ({ input, ctx }) => {
    const [decision, staff] = await Promise.all([
      routeLead({
        organizationId: ctx.organizationId,
        inquiryType: input.type,
        companyName: input.company,
        industry: input.industry,
        lastOwnerAssignedAt: (userIds) => lastOwnerAssignedAt(ctx.organizationId, userIds),
      }),
      listStaff(ctx.organizationId),
    ])
    const ownerName = decision.ownerUserId
      ? (staff.find((s) => s.userId === decision.ownerUserId)?.displayName ?? decision.ownerUserId)
      : '(unrouted)'
    return {
      ok: true as const,
      data: { decision, ownerName },
      summary: `${input.type} → ${ownerName} [${decision.matchKind}]\n  ${decision.reason}`,
    }
  },
  formatHint: 'json',
})

export const routingCheckVerb = defineCliVerb({
  name: 'routing check',
  description:
    'Validate routing config — rules (rep resolution, orphan pools) plus the attribute-driven team-lead fallback.',
  readOnly: true,
  input: z.object({}),
  body: async ({ ctx }) => {
    const [rules, staff] = await Promise.all([listRoutingRules(ctx.organizationId), listStaff(ctx.organizationId)])
    const staffIds = new Set(staff.map((s) => s.userId))
    const issues: string[] = []
    const warnings: string[] = []

    // ─── Rule integrity ─────────────────────────────────────────────────────
    for (const r of rules) {
      if (r.repUserId && !staffIds.has(r.repUserId)) {
        issues.push(`rule ${r.id} (${r.kind}) references unknown rep user:${r.repUserId}`)
      }
    }
    const poolKeywords = new Set(rules.filter((r) => r.kind === 'pool_keyword').map((r) => r.pool))
    const poolsWithMembers = new Set(rules.filter((r) => r.kind === 'pool_member').map((r) => r.pool))
    for (const pool of poolKeywords) {
      if (pool && !poolsWithMembers.has(pool)) issues.push(`pool "${pool}" has a keyword but no members`)
    }
    for (const pool of poolsWithMembers) {
      if (pool && !poolKeywords.has(pool)) issues.push(`pool "${pool}" has members but no keyword routes to it`)
    }

    // ─── Attribute-driven fallback ──────────────────────────────────────────
    // lead-routing.ts walks: exclusive → pool → corporate_team_lead fallback.
    // Mirror those attribute reads (`corporate_team`, `private_team`, `team_lead`)
    // so an empty team or missing lead is flagged BEFORE a real inquiry lands.
    const isTrue = (s: (typeof staff)[number], key: string): boolean => s.attributes?.[key] === true
    const corpTeam = staff.filter((s) => isTrue(s, 'corporate_team'))
    const privTeam = staff.filter((s) => isTrue(s, 'private_team'))
    const corpLeads = corpTeam.filter((s) => isTrue(s, 'team_lead'))
    const privLeads = privTeam.filter((s) => isTrue(s, 'team_lead'))

    if (corpLeads.length === 0) {
      issues.push(
        'no staff with corporate_team=true AND team_lead=true — corporate inquiries with no rule match will be unrouted',
      )
    }
    if (privTeam.length === 0) {
      issues.push('no staff with private_team=true — private inquiries will be unrouted')
    } else if (privLeads.length === 0) {
      // Strict-intersection means private_lead fallback only ever fires when a member
      // also carries team_lead. Without one, a fully-unavailable Private team unroutes.
      warnings.push(
        'no staff with private_team=true AND team_lead=true — if every private member is off/inactive, leads go unrouted',
      )
    }

    // Lead-with-no-team — informational. Such a user is invisible to routing.
    for (const s of staff) {
      if (isTrue(s, 'team_lead') && !isTrue(s, 'corporate_team') && !isTrue(s, 'private_team')) {
        warnings.push(
          `user:${s.userId} (${s.displayName ?? '?'}) has team_lead=true but neither corporate_team nor private_team — will never receive fallback leads`,
        )
      }
    }

    const lines: string[] = []
    if (issues.length === 0 && warnings.length === 0) {
      lines.push(`OK — ${rules.length} rules, no issues.`)
    } else {
      lines.push(
        `${issues.length} issue(s), ${warnings.length} warning(s) across ${rules.length} rules + attribute fallback config:`,
      )
      for (const i of issues) lines.push(`  ✗ ${i}`)
      for (const w of warnings) lines.push(`  ⚠ ${w}`)
    }
    lines.push('')
    lines.push(
      `Corporate team: ${corpTeam.length} member(s), ${corpLeads.length} lead(s) (${corpLeads.map((s) => s.displayName ?? s.userId).join(', ') || 'none'}).`,
    )
    lines.push(
      `Private team: ${privTeam.length} member(s), ${privLeads.length} lead(s) (${privLeads.map((s) => s.displayName ?? s.userId).join(', ') || 'none'}).`,
    )

    return {
      ok: true as const,
      data: {
        issues,
        warnings,
        ruleCount: rules.length,
        corporateTeam: corpTeam.map((s) => s.userId),
        corporateLeads: corpLeads.map((s) => s.userId),
        privateTeam: privTeam.map((s) => s.userId),
        privateLeads: privLeads.map((s) => s.userId),
      },
      summary: lines.join('\n'),
    }
  },
  formatHint: 'json',
})

export const routingVerbs = [routingListVerb, routingSetVerb, routingRmVerb, routingSimulateVerb, routingCheckVerb]
