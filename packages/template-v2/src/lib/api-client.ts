/**
 * Typed Hono RPC clients for each module.
 *
 * Each client is created via `hc<RouteType>('/api/{module}')` where the route
 * type is derived from `typeof app` exported by the module's handlers/index.ts.
 *
 * Bundle invariant: only `import type` — no runtime value imports from
 * @server/runtime/* or @modules/agents/wake/* are allowed in src/**. The handler
 * files themselves import drizzle/server deps; we only pull in the inferred
 * Hono app type so Vite strips it at build time.
 */

import type agentsApp from '@modules/agents/handlers/index'
import type changesApp from '@modules/changes/handlers/index'
import type webAdapterApp from '@modules/channels/adapters/web/handlers/index'
import type channelsApp from '@modules/channels/handlers/index'
import type contactsApp from '@modules/contacts/handlers/index'
import type driveApp from '@modules/drive/handlers/index'
import type messagingApp from '@modules/messaging/handlers/index'
import type settingsApp from '@modules/settings/handlers/index'
import type systemApp from '@modules/system/handlers/index'
import type teamApp from '@modules/team/handlers/index'
import { hc } from 'hono/client'

// ── Per-module typed clients ──────────────────────────────────────────────────

export const messagingClient = hc<typeof messagingApp>('/api/messaging')

export const agentsClient = hc<typeof agentsApp>('/api/agents')

export const contactsClient = hc<typeof contactsApp>('/api/contacts')

export const driveClient = hc<typeof driveApp>('/api/drive')

export const settingsClient = hc<typeof settingsApp>('/api/settings')

export const channelsClient = hc<typeof channelsApp>('/api/channels')

export const changesClient = hc<typeof changesApp>('/api/changes')

/** Web-adapter-specific routes (anonymous-session, session-authed inbound, card-reply, public). */
export const channelWebClient = hc<typeof webAdapterApp>('/api/channels/adapters/web')

export const systemClient = hc<typeof systemApp>('/api/system')

export const teamClient = hc<typeof teamApp>('/api/team')
