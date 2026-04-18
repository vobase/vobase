import type { ModuleManifest } from '@server/runtime/define-module'

export const manifest: ModuleManifest = {
  provides: {
    commands: ['drive:ls', 'drive:cat', 'drive:grep', 'drive:find'],
    materializers: ['businessMdMaterializer', 'driveFolderMaterializer'],
    channels: [],
  },
  permissions: [],
}
