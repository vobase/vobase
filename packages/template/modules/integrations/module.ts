/**
 * `integrations` module — owns the tenant-side secret vault for
 * platform-managed integrations (currently `vobase-platform` for managed
 * WhatsApp).
 *
 * Boot is intentionally minimal: just install the vault registry so other
 * modules can `getVaultFor(orgId)`. The legacy `PLATFORM_AUTO_BOOTSTRAP`
 * boot-time handshake was removed in favor of the click-driven flow at
 * `POST /api/channels/whatsapp/managed/claim` — see
 * `modules/channels/adapters/whatsapp/handlers/managed.ts`.
 */

import type { ModuleDef } from '~/runtime'
import { installVaultRegistry } from './service/registry'
import * as web from './web'

const integrations: ModuleDef = {
  name: 'integrations',
  requires: ['channels'],
  web: { routes: web.routes },
  jobs: [],
  init(ctx) {
    installVaultRegistry({ db: ctx.db })
  },
}

export default integrations
