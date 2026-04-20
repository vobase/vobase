import type { Context, MiddlewareHandler } from 'hono'
import type { Auth } from '../auth'

type BaseSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>

export type AppSession = BaseSession

export interface SessionEnv {
  Variables: { session: AppSession }
}

export function createRequireSession(auth: Auth): MiddlewareHandler {
  return async (c: Context<SessionEnv>, next): Promise<Response | undefined> => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) return c.json({ error: 'unauthenticated' }, 401)
    c.set('session', session)
    await next()
    return undefined
  }
}
