import type { ModuleManifest } from '@server/runtime/define-module'

export const manifest: ModuleManifest = {
  provides: {
    tools: ['reply', 'send_card', 'send_file', 'book_slot'],
    commands: ['inbox:list', 'inbox:get', 'inbox:resolve', 'inbox:reassign'],
    materializers: ['conversationMaterializer', 'internalNotesMaterializer'],
  },
  permissions: [],
}
