/**
 * Lead-routing service — turns a qualified inquiry into a staff owner.
 *
 * Two inquiry types, two strategies:
 *   - `corporate` — keyword-driven. An `exclusive` rule (longest keyword wins)
 *     pins a named account to one rep; a `pool_keyword` rule sends a sector to
 *     a round-robin pool. No rule matches → round-robin across Corporate team
 *     leads (`corporate_team=true AND team_lead=true`).
 *   - `private` — round-robin across the whole Private team (members marked
 *     `private_team=true`). No available member → Private team leads
 *     (`private_team=true AND team_lead=true`).
 *
 * Team membership is attribute-driven (no better-auth `auth.team` lookup):
 * `staff_profiles.attributes->>'corporate_team'`, `'private_team'`, `'team_lead'`
 * are yes/no booleans defined in `staff_attribute_definitions`. This keeps
 * routing config in one place — the staff record — without a separate teams
 * surface to keep in sync.
 *
 * Round-robin is least-recently-assigned (LRA): the candidate whose most
 * recent owned conversation is oldest (never-owned wins first). The LRA reader
 * is INJECTED by the caller (`lastOwnerAssignedAt`) so this service never
 * imports the messaging module — keeping the team→messaging dependency
 * one-directional and the matching logic unit-testable.
 *
 * `routing_rules` is the sole routing config table; `staff_profiles.sectors[]`
 * stays free for HR semantics.
 */

import { routingRules, staffProfiles } from '@modules/team/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'

import type { RoutingRule, RoutingRuleKind } from '../schema'

/** Availability values a rep must NOT be in to receive a routed lead. */
const UNAVAILABLE = new Set(['off', 'inactive'])

/** Attribute keys (defined in `staff_attribute_definitions` as boolean). */
const ATTR_CORPORATE_TEAM = 'corporate_team'
const ATTR_PRIVATE_TEAM = 'private_team'
const ATTR_TEAM_LEAD = 'team_lead'

export type RouteMatchKind = 'exclusive' | 'pool' | 'private' | 'corporate_lead' | 'private_lead' | 'unrouted'

export interface RouteLeadRequest {
  organizationId: string
  inquiryType: 'corporate' | 'private'
  companyName?: string
  industry?: string
  /**
   * Least-recently-assigned reader — `userId → most-recent owner_assigned_at`
   * (null = never owned a conversation). Injected so this service stays free
   * of a messaging-module import; the `route_lead` tool binds it to
   * `messaging`'s `lastOwnerAssignedAt`.
   */
  lastOwnerAssignedAt: (userIds: string[]) => Promise<Map<string, Date | null>>
}

export interface RouteLeadDecision {
  /** The routed staff member, or null when nothing could be resolved. */
  ownerUserId: string | null
  matchKind: RouteMatchKind
  /** Human-readable explanation for the audit note. */
  reason: string
  /** The keyword that matched, when one did. */
  matchedKeyword?: string
  /** The pool that was drawn from, when one was. */
  pool?: string
}

export interface UpsertRoutingRuleInput {
  organizationId: string
  kind: RoutingRuleKind
  keyword?: string | null
  pool?: string | null
  repUserId?: string | null
  priority?: number
}

export interface LeadRoutingService {
  routeLead(req: RouteLeadRequest): Promise<RouteLeadDecision>
  listRules(organizationId: string): Promise<RoutingRule[]>
  upsertRule(input: UpsertRoutingRuleInput): Promise<RoutingRule>
  removeRule(organizationId: string, id: string): Promise<void>
}

// ─── Pure matching helpers (unit-tested directly) ────────────────────────────

/** Lowercase haystack from a company name + industry, collapsed whitespace. */
export function buildHaystack(companyName?: string, industry?: string): string {
  return `${companyName ?? ''} ${industry ?? ''}`.toLowerCase().replace(/\s+/gu, ' ').trim()
}

/**
 * Whole-word/phrase match — `keyword` must appear in `haystack` bounded by
 * non-word characters (or string ends). Avoids the substring false positives
 * a plain `includes` would hit ("gas" inside "Glasgow", "hp" inside
 * "championship").
 */
export function keywordInHaystack(haystack: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`\\b${escaped}\\b`, 'u').test(haystack)
}

/**
 * Among `rules` whose `keyword` matches `haystack` as a whole word/phrase,
 * return the one with the longest keyword (most specific). Ties break by
 * higher `priority`, then keyword ascending — deterministic so routing is
 * reproducible.
 */
export function pickKeywordMatch(rules: readonly RoutingRule[], haystack: string): RoutingRule | null {
  let best: RoutingRule | null = null
  for (const rule of rules) {
    const kw = rule.keyword
    if (!kw || !keywordInHaystack(haystack, kw)) continue
    if (best === null) {
      best = rule
      continue
    }
    const bestKw = best.keyword ?? ''
    if (kw.length !== bestKw.length) {
      if (kw.length > bestKw.length) best = rule
    } else if (rule.priority !== best.priority) {
      if (rule.priority > best.priority) best = rule
    } else if (kw < bestKw) {
      best = rule
    }
  }
  return best
}

/**
 * Order `candidates` least-recently-assigned first: a candidate with no
 * timestamp (never owned a conversation) sorts before any dated one; among
 * dated candidates, older wins. Ties break by userId ascending.
 */
export function orderByLeastRecentlyAssigned(
  candidates: readonly string[],
  lra: ReadonlyMap<string, Date | null>,
): string[] {
  return [...candidates].sort((a, b) => {
    const ta = lra.get(a) ?? null
    const tb = lra.get(b) ?? null
    if (ta === null && tb === null) return a < b ? -1 : a > b ? 1 : 0
    if (ta === null) return -1
    if (tb === null) return 1
    if (ta.getTime() !== tb.getTime()) return ta.getTime() - tb.getTime()
    return a < b ? -1 : a > b ? 1 : 0
  })
}

// ─── Service factory ─────────────────────────────────────────────────────────

interface Deps {
  db: unknown
}

export function createLeadRoutingService(deps: Deps): LeadRoutingService {
  const db = deps.db as { select: Function; insert: Function; delete: Function }

  async function listRules(organizationId: string): Promise<RoutingRule[]> {
    const rows = (await db
      .select()
      .from(routingRules)
      .where(eq(routingRules.organizationId, organizationId))) as unknown[]
    return rows as RoutingRule[]
  }

  /** userIds whose `staff_profiles.attributes[key]` is the boolean `true`. Org-scoped. */
  async function staffWithAttribute(organizationId: string, key: string): Promise<string[]> {
    const rows = (await db
      .select({ userId: staffProfiles.userId })
      .from(staffProfiles)
      .where(
        and(
          eq(staffProfiles.organizationId, organizationId),
          // JSONB boolean — stored values are JS booleans serialized to JSON
          // (text 'true'/'false'); `->>` returns the text form either way.
          sql`${staffProfiles.attributes}->>${key} = 'true'`,
        ),
      )) as Array<{ userId: string }>
    return rows.map((r) => r.userId)
  }

  /** Intersection of two userId arrays, preserving the order of the first. */
  function intersect(a: readonly string[], b: readonly string[]): string[] {
    const bSet = new Set(b)
    return a.filter((id) => bSet.has(id))
  }

  /** Filter `userIds` down to reps whose availability is not `off`/`inactive`. Order preserved. */
  async function filterAvailable(organizationId: string, userIds: readonly string[]): Promise<string[]> {
    if (userIds.length === 0) return []
    const rows = (await db
      .select({ userId: staffProfiles.userId, availability: staffProfiles.availability })
      .from(staffProfiles)
      .where(
        and(eq(staffProfiles.organizationId, organizationId), inArray(staffProfiles.userId, [...userIds])),
      )) as Array<{ userId: string; availability: string }>
    const ok = new Set(rows.filter((r) => !UNAVAILABLE.has(r.availability)).map((r) => r.userId))
    return userIds.filter((id) => ok.has(id))
  }

  /**
   * Pick the least-recently-assigned candidate via the injected LRA reader.
   * `candidates` must be non-empty — callers gate on `available.length > 0`.
   */
  async function roundRobin(
    candidates: readonly string[],
    lastOwnerAssignedAt: RouteLeadRequest['lastOwnerAssignedAt'],
  ): Promise<string> {
    const lra = await lastOwnerAssignedAt([...candidates])
    const pick = orderByLeastRecentlyAssigned(candidates, lra)[0]
    if (!pick) throw new Error('team/lead-routing: roundRobin called with no candidates')
    return pick
  }

  async function routeCorporate(req: RouteLeadRequest): Promise<RouteLeadDecision> {
    const haystack = buildHaystack(req.companyName, req.industry)
    const rules = await listRules(req.organizationId)

    // 1. Exclusive named-account match — longest keyword wins.
    const exclusive = pickKeywordMatch(
      rules.filter((r) => r.kind === 'exclusive'),
      haystack,
    )
    if (exclusive?.repUserId) {
      return {
        ownerUserId: exclusive.repUserId,
        matchKind: 'exclusive',
        reason: `Corporate account match on "${exclusive.keyword}"`,
        matchedKeyword: exclusive.keyword ?? undefined,
      }
    }

    // 2. Pool keyword → round-robin across that pool's available members.
    const poolKw = pickKeywordMatch(
      rules.filter((r) => r.kind === 'pool_keyword'),
      haystack,
    )
    if (poolKw?.pool) {
      const memberIds = rules
        .filter((r) => r.kind === 'pool_member' && r.pool === poolKw.pool && r.repUserId)
        .map((r) => r.repUserId as string)
      const available = await filterAvailable(req.organizationId, memberIds)
      if (available.length > 0) {
        const pick = await roundRobin(available, req.lastOwnerAssignedAt)
        return {
          ownerUserId: pick,
          matchKind: 'pool',
          reason: `Corporate "${poolKw.keyword}" → ${poolKw.pool} pool (round-robin)`,
          matchedKeyword: poolKw.keyword ?? undefined,
          pool: poolKw.pool,
        }
      }
    }

    // 3. No rule matched — round-robin across Corporate team leads
    //    (`corporate_team=true AND team_lead=true`).
    const corporate = await staffWithAttribute(req.organizationId, ATTR_CORPORATE_TEAM)
    const leads = await staffWithAttribute(req.organizationId, ATTR_TEAM_LEAD)
    const leadIds = intersect(corporate, leads)
    const availableLeads = await filterAvailable(req.organizationId, leadIds)
    if (availableLeads.length > 0) {
      const pick = await roundRobin(availableLeads, req.lastOwnerAssignedAt)
      const note =
        availableLeads.length === 1
          ? 'Corporate inquiry with no matching rule — routed to Corporate team lead'
          : `Corporate inquiry with no matching rule — routed to Corporate team lead (round-robin among ${availableLeads.length} leads)`
      return {
        ownerUserId: pick,
        matchKind: 'corporate_lead',
        reason: note,
      }
    }
    return {
      ownerUserId: null,
      matchKind: 'unrouted',
      reason:
        'Corporate inquiry with no matching rule and no Corporate team lead configured (need staff with corporate_team=true AND team_lead=true)',
    }
  }

  async function routePrivate(req: RouteLeadRequest): Promise<RouteLeadDecision> {
    // 1. Round-robin across the Private team (`private_team=true`).
    const memberIds = await staffWithAttribute(req.organizationId, ATTR_PRIVATE_TEAM)
    const available = await filterAvailable(req.organizationId, memberIds)
    if (available.length > 0) {
      const pick = await roundRobin(available, req.lastOwnerAssignedAt)
      return {
        ownerUserId: pick,
        matchKind: 'private',
        reason: 'Private inquiry — round-robin across the Private team',
      }
    }

    // 2. No available member — fall back to Private team leads
    //    (`private_team=true AND team_lead=true`).
    const leads = await staffWithAttribute(req.organizationId, ATTR_TEAM_LEAD)
    const leadIds = intersect(memberIds, leads)
    const availableLeads = await filterAvailable(req.organizationId, leadIds)
    if (availableLeads.length > 0) {
      const pick = await roundRobin(availableLeads, req.lastOwnerAssignedAt)
      const note =
        availableLeads.length === 1
          ? 'Private inquiry with no available team member — routed to Private team lead'
          : `Private inquiry with no available team member — routed to Private team lead (round-robin among ${availableLeads.length} leads)`
      return {
        ownerUserId: pick,
        matchKind: 'private_lead',
        reason: note,
      }
    }

    return {
      ownerUserId: null,
      matchKind: 'unrouted',
      reason:
        'Private inquiry but no Private team configured (need staff with private_team=true, or private_team=true AND team_lead=true for fallback)',
    }
  }

  function decide(req: RouteLeadRequest): Promise<RouteLeadDecision> {
    return req.inquiryType === 'corporate' ? routeCorporate(req) : routePrivate(req)
  }

  async function upsertRule(input: UpsertRoutingRuleInput): Promise<RoutingRule> {
    const values = {
      organizationId: input.organizationId,
      kind: input.kind,
      keyword: input.keyword ?? null,
      pool: input.pool ?? null,
      repUserId: input.repUserId ?? null,
      priority: input.priority ?? 0,
    }
    // Delete-then-insert keeps the write predictable across the keyword-keyed
    // rule kinds (exclusive/pool_keyword) and the keyword-less pool_member kind.
    if (values.kind === 'pool_member') {
      await db
        .delete(routingRules)
        .where(
          and(
            eq(routingRules.organizationId, values.organizationId),
            eq(routingRules.kind, 'pool_member'),
            eq(routingRules.pool, values.pool ?? ''),
            eq(routingRules.repUserId, values.repUserId ?? ''),
          ),
        )
    } else {
      await db
        .delete(routingRules)
        .where(
          and(eq(routingRules.organizationId, values.organizationId), eq(routingRules.keyword, values.keyword ?? '')),
        )
    }
    const rows = (await db.insert(routingRules).values(values).returning()) as unknown[]
    if (!rows[0]) throw new Error('team/lead-routing: upsertRule insert returned no rows')
    return rows[0] as RoutingRule
  }

  async function removeRule(organizationId: string, id: string): Promise<void> {
    await db.delete(routingRules).where(and(eq(routingRules.organizationId, organizationId), eq(routingRules.id, id)))
  }

  return { routeLead: decide, listRules, upsertRule, removeRule }
}

// ─── Process-level singleton ─────────────────────────────────────────────────

let _current: LeadRoutingService | null = null

export function installLeadRoutingService(svc: LeadRoutingService): void {
  _current = svc
}

export function __resetLeadRoutingServiceForTests(): void {
  _current = null
}

function currentSvc(): LeadRoutingService {
  if (!_current) throw new Error('team/lead-routing: service not installed — call installLeadRoutingService()')
  return _current
}

export function routeLead(req: RouteLeadRequest): Promise<RouteLeadDecision> {
  return currentSvc().routeLead(req)
}
export function listRoutingRules(organizationId: string): Promise<RoutingRule[]> {
  return currentSvc().listRules(organizationId)
}
export function upsertRoutingRule(input: UpsertRoutingRuleInput): Promise<RoutingRule> {
  return currentSvc().upsertRule(input)
}
export function removeRoutingRule(organizationId: string, id: string): Promise<void> {
  return currentSvc().removeRule(organizationId, id)
}
