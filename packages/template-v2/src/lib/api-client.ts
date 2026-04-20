/**
 * Typed Hono RPC clients for each module.
 *
 * Each client is created via `hc<RouteType>('/api/{module}')` where the route
 * type is derived from `typeof app` exported by the module's handlers/index.ts.
 *
 * Bundle invariant: only `import type` — no runtime value imports from
 * @server/runtime/* or @server/harness/* are allowed in src/**. The handler
 * files themselves import drizzle/server deps; we only pull in the inferred
 * Hono app type so Vite strips it at build time.
 */

import type agentsApp from '@modules/agents/handlers/index'
import type channelWebApp from '@modules/channel-web/handlers/index'
import type contactsApp from '@modules/contacts/handlers/index'
import type inboxApp from '@modules/inbox/handlers/index'
import type settingsApp from '@modules/settings/handlers/index'
import type systemApp from '@modules/system/handlers/index'
import { hc } from 'hono/client'

// ── Per-module typed clients ──────────────────────────────────────────────────

export const inboxClient = hc<typeof inboxApp>('/api/inbox')

export const agentsClient = hc<typeof agentsApp>('/api/agents')

export const contactsClient = hc<typeof contactsApp>('/api/contacts')

export const settingsClient = hc<typeof settingsApp>('/api/settings')

export const channelWebClient = hc<typeof channelWebApp>('/api/channel-web')

export const systemClient = hc<typeof systemApp>('/api/system')
