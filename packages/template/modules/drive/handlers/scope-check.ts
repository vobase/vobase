/**
 * Drive scope-check helpers shared by `index.ts` (route-level middleware) and
 * `files.ts` (in-handler row-derived checks).
 *
 * Lives outside `index.ts`/`files.ts` to avoid the import cycle between the two
 * (the route table imports the handler module, the handler module needs the
 * row-derived check helper).
 */

import type { Auth } from '@auth'
import { assertScopeAccess, type DriveScopeForRbac, type OrganizationEnv, requireOrganization } from '@auth/middleware'
import type { Context } from 'hono'

import { getDriveAuth } from '../service/files'

/**
 * Imperative scope check for routes that derive scope from a DB row (DELETE
 * `/file/:id`, POST `/moves`). Loads the row via `loadScope()`, then runs
 * `assertScopeAccess`. Returns a Response to abort with, or `undefined` to
 * proceed.
 *
 * Assumes `requireOrganization` has already populated `c.get('organizationId')`
 * (route-level middleware in `handlers/index.ts` ensures this).
 */
export async function rowScopeCheck(
  c: Context<OrganizationEnv>,
  loadScope: () => Promise<DriveScopeForRbac | null>,
  write: boolean,
): Promise<Response | undefined> {
  const auth = getDriveAuth() as Auth | null
  if (!auth) return undefined
  const scope = await loadScope()
  if (!scope) return c.json({ error: 'not_found' }, 404)
  return assertScopeAccess(auth, c, scope, write)
}

/**
 * Translate a `drive_files` row's `(scope, scopeId)` pair into the
 * `DriveScopeForRbac` discriminator. Returns `null` when the scope text is
 * outside the known set (defensive — the CHECK constraint should make this
 * unreachable in practice).
 */
export function scopeFromRow(row: { scope: string; scopeId: string }): DriveScopeForRbac | null {
  if (row.scope === 'organization') return { scope: 'organization' }
  if (row.scope === 'contact') return { scope: 'contact', contactId: row.scopeId }
  if (row.scope === 'staff') return { scope: 'staff', userId: row.scopeId }
  if (row.scope === 'agent') return { scope: 'agent', agentId: row.scopeId }
  return null
}

// Re-export for callers that want a single import path.
export { requireOrganization }
