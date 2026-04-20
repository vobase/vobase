import type { Context, MiddlewareHandler } from 'hono'
import type { Auth } from '../auth'
import type { OrganizationEnv } from './require-organization'

/** better-auth's permission shape: `{ resource: ['action', ...] }`. */
export type PermissionCheck = Record<string, string[]>

/**
 * `plugins: BetterAuthPlugin[]` in `createAuth` erases per-plugin API augmentation,
 * so we narrow the `hasPermission` endpoint here. The plugin's response key has
 * varied between `success` and `hasPermission` across versions — accept either.
 */
type AuthApiWithHasPermission = Auth['api'] & {
  hasPermission: (opts: {
    headers: Headers
    body: { permissions: PermissionCheck; organizationId?: string }
  }) => Promise<{ success?: boolean; hasPermission?: boolean } | null>
}

/**
 * Delegates to `auth.api.hasPermission` server-side so dynamic roles (created
 * at runtime via `createRole`) are included — the client-side `hasPermission`
 * is static-AC-only and would miss them. Never use the client method for authz.
 */
export function createRequirePermission(auth: Auth, permissions: PermissionCheck): MiddlewareHandler {
  const api = auth.api as AuthApiWithHasPermission
  return async (c: Context<OrganizationEnv>, next): Promise<Response | undefined> => {
    const organizationId = c.get('organizationId')
    const result = await api.hasPermission({
      headers: c.req.raw.headers,
      body: { permissions, organizationId },
    })
    const ok = result?.success ?? result?.hasPermission ?? false
    if (!ok) return c.json({ error: 'forbidden' }, 403)
    await next()
    return undefined
  }
}
