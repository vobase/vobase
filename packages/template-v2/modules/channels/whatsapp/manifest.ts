import type { ModuleManifest } from '@server/runtime/define-module'

export const manifest: ModuleManifest = {
  provides: {
    channels: ['whatsapp'],
  },
  permissions: [],
  workspace: { owns: [] },
  accessGrants: [
    { to: 'inbox', reason: 'A3 inbound via InboxPort' },
    { to: 'contacts', reason: 'contact resolution' },
  ],
}
