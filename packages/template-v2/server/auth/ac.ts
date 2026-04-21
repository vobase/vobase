/**
 * Access-control statement + roles for template-v2.
 *
 * Template-v2 owns the AC (not core) so domain permissions (`drive`, `contact`,
 * `agent`, `staff`) live alongside the modules that define them. `team` is
 * kept inside the statement for completeness — better-auth's defaultStatements
 * already exposes `team: [create|update|delete]`, and we inherit those.
 *
 * Register via `extraPlugins` on the organization plugin: `organization({ ac, roles, teams })`.
 */

import { createAccessControl } from 'better-auth/plugins/access'
import {
  defaultStatements,
  adminAc as orgAdminAc,
  memberAc as orgMemberAc,
  ownerAc as orgOwnerAc,
} from 'better-auth/plugins/organization/access'

export const statement = {
  ...defaultStatements,
  drive: ['read', 'write', 'propose', 'approve'],
  contact: ['read', 'assign', 'write'],
  agent: ['configure', 'override'],
  // `team` already provided by defaultStatements (create/update/delete) — no need to redeclare.
  staff: ['read', 'write:self', 'write:any'],
} as const

export const ac = createAccessControl(statement)

export const ownerRole = ac.newRole({
  ...(orgOwnerAc.statements as Record<string, readonly string[]>),
  drive: ['read', 'write', 'propose', 'approve'],
  contact: ['read', 'assign', 'write'],
  agent: ['configure', 'override'],
  staff: ['read', 'write:self', 'write:any'],
})

export const adminRole = ac.newRole({
  ...(orgAdminAc.statements as Record<string, readonly string[]>),
  drive: ['read', 'write', 'propose', 'approve'],
  contact: ['read', 'assign', 'write'],
  agent: ['configure', 'override'],
  staff: ['read', 'write:self', 'write:any'],
})

export const memberRole = ac.newRole({
  ...(orgMemberAc.statements as Record<string, readonly string[]>),
  drive: ['read', 'propose'],
  contact: ['read'],
  agent: [],
  staff: ['read', 'write:self'],
})

export const roles = {
  owner: ownerRole,
  admin: adminRole,
  member: memberRole,
}
