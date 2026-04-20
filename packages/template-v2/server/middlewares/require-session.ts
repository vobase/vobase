import type { Context, MiddlewareHandler } from 'hono'
import type { Auth } from '../auth'

type BaseSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>

/**
 * Typing better-auth as `plugins: BetterAuthPlugin[]` widens the array and
 * discards per-plugin type additions, so `session.session.activeOrganizationId`
 * isn't inferred. We splice it back in here by hand.
 */
export type AppSession = Omit<BaseSession, 'session'> & {
  session: BaseSession['session'] & { activeOrganizationId: string | null }
}

export interface SessionEnv {
  Variables: { session: AppSession }
}

export function createRequireSession(auth: Auth): MiddlewareHandler {
  return async (c: Context<SessionEnv>, next): Promise<Response | undefined> => {
    const session = (await auth.api.getSession({ headers: c.req.raw.headers })) as AppSession | null
    if (!session) return c.json({ error: 'unauthenticated' }, 401)
    c.set('session', session)
    await next()
    return undefined
  }
}
