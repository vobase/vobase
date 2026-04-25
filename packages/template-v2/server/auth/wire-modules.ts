import { installDriveAuth } from '@modules/drive/service/files'
import { installChannelWebAuth } from '@server/transports/web/service/state'

import type { Auth } from './index'

/**
 * Patch the auth handle into modules that need session reads but boot before
 * auth is available. Call after `bootModules()` so each module's `init()` has
 * already installed its state.
 */
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function wireAuthIntoModules(auth: Auth): Promise<void> {
  installChannelWebAuth(auth)

  installDriveAuth(auth)
}
