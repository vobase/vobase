import type { Auth } from './index'

/**
 * Patch the auth handle into modules that need session reads but boot before
 * auth is available. Call after `bootModules()` so each module's `init()` has
 * already installed its state.
 */
export async function wireAuthIntoModules(auth: Auth): Promise<void> {
  const { installChannelWebAuth } = await import('@modules/channels/web/service/state')
  installChannelWebAuth(auth)

  const { installDriveAuth } = await import('@modules/drive/service/files')
  installDriveAuth(auth)
}
