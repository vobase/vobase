/**
 * Principal directory — resolves `agent:<id>` / `staff:<id>` / `contact:<id>`
 * tokens to a unified record with kind-specific metadata for the hovercard.
 *
 * Tokens match the format used in `change_history.changedBy`, conversation
 * assignee strings, and note `mentions[]` so the same string flows from DB to
 * UI without per-call-site parsing.
 *
 * Presence: a staff member is "online" when `availability === 'active'` and
 * `lastSeenAt` is within the heartbeat window. Threshold matches the mention
 * fan-out logic on the server (`mention-notify.ts`).
 */

import { useAgentDefinitions } from '@modules/agents/hooks/use-agent-definitions'
import { useContactsList } from '@modules/contacts/hooks/use-contacts'
import { useStaffList } from '@modules/team/hooks/use-staff'
import type { Availability } from '@modules/team/schema'
import { useMemo } from 'react'

export type PrincipalKind = 'agent' | 'staff' | 'contact'

// Must stay in sync with `OFFLINE_THRESHOLD_MS` in
// `modules/team/service/mention-notify.ts` — server uses the same window to
// decide when to fan a WhatsApp ping for an offline mention recipient.
const PRESENCE_THRESHOLD_MS = 2 * 60 * 1000

export interface AgentMeta {
  model: string
  enabled: boolean
}

export interface StaffMeta {
  title: string | null
  availability: Availability
  isOnline: boolean
  lastSeenAt: Date | null
}

export interface ContactMeta {
  email: string | null
  phone: string | null
}

export interface PrincipalRecord {
  kind: PrincipalKind
  id: string
  /** Canonical `kind:id` token. Round-trips through DB and wire formats. */
  token: string
  name: string
  /** Exactly one populated, matching `kind`. */
  agent?: AgentMeta
  staff?: StaffMeta
  contact?: ContactMeta
}

export interface PrincipalDirectory {
  resolve(value: string | null | undefined): PrincipalRecord | null
  agents: PrincipalRecord[]
  staff: PrincipalRecord[]
  contacts: PrincipalRecord[]
}

export function usePrincipalDirectory(): PrincipalDirectory {
  const { data: agentDefs = [] } = useAgentDefinitions()
  const { data: staffList = [] } = useStaffList()
  const { data: contactList = [] } = useContactsList()

  return useMemo(() => {
    const now = Date.now()

    const agents: PrincipalRecord[] = agentDefs.map((a) => ({
      kind: 'agent',
      id: a.id,
      token: `agent:${a.id}`,
      name: a.name,
      agent: { model: a.model, enabled: a.enabled },
    }))

    const staff: PrincipalRecord[] = staffList.map((s) => {
      const lastSeen = parseDate(s.lastSeenAt)
      const isOnline =
        lastSeen !== null && s.availability === 'active' && now - lastSeen.getTime() <= PRESENCE_THRESHOLD_MS
      return {
        kind: 'staff',
        id: s.userId,
        token: `staff:${s.userId}`,
        name: s.displayName ?? humanize(s.userId),
        staff: { title: s.title, availability: s.availability, isOnline, lastSeenAt: lastSeen },
      }
    })

    const contacts: PrincipalRecord[] = contactList.map((c) => ({
      kind: 'contact',
      id: c.id,
      token: `contact:${c.id}`,
      name: c.displayName ?? humanize(c.id),
      contact: { email: c.email, phone: c.phone },
    }))

    const byToken = new Map<string, PrincipalRecord>()
    for (const r of agents) byToken.set(r.token, r)
    for (const r of staff) byToken.set(r.token, r)
    for (const r of contacts) byToken.set(r.token, r)

    function resolve(value: string | null | undefined): PrincipalRecord | null {
      if (!value) return null
      const direct = byToken.get(value)
      if (direct) return direct
      // Legacy: assignee strings sometimes use `user:<id>` for staff.
      if (value.startsWith('user:')) return byToken.get(`staff:${value.slice(5)}`) ?? null
      // Bare id with no prefix — historical convention is staff.
      if (!value.includes(':')) return byToken.get(`staff:${value}`) ?? null
      return null
    }

    return { resolve, agents, staff, contacts }
  }, [agentDefs, staffList, contactList])
}

function humanize(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]/g, ' ')
}

function parseDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}
