/**
 * Staff display-name lookup against `auth_user` rows.
 *
 * Used by team materializers to resolve "who is staff_xyz?" → `name`/`email`
 * for the `/staff/<id>/profile.md` panel. Lives under `auth/` because it
 * reads better-auth tables; modules that need it import from `@auth/lookup`.
 *
 * Lookups are best-effort: missing rows / DB errors return `null` rather
 * than throwing, so wake assembly never fails on a stale staff reference.
 */

import { authUser } from '@vobase/core'
import { eq } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'

export interface AuthLookup {
  getAuthDisplay(staffId: string): Promise<{ name: string | null; email: string | null } | null>
}

export function buildAuthLookup(db: ScopedDb | undefined): AuthLookup {
  if (!db) {
    return {
      // biome-ignore lint/suspicious/useAwait: contract requires async signature
      async getAuthDisplay() {
        return null
      },
    }
  }
  return {
    async getAuthDisplay(staffId) {
      try {
        const rows = await db
          .select({ name: authUser.name, email: authUser.email })
          .from(authUser)
          .where(eq(authUser.id, staffId))
          .limit(1)
        const row = rows[0]
        if (!row) return null
        return { name: row.name, email: row.email }
      } catch {
        return null
      }
    },
  }
}
