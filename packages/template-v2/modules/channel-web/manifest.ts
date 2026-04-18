import type { ModuleManifest } from '@server/runtime/define-module'

export const manifest: ModuleManifest = {
  provides: {
    channels: ['web'],
  },
  permissions: [],
}
