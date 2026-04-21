import type { ModuleManifest } from '@server/runtime/define-module'

export const manifest: ModuleManifest = {
  provides: {
    tools: ['reply', 'send_card', 'send_file', 'book_slot'],
    commands: ['inbox:list', 'inbox:get', 'inbox:resolve', 'inbox:reassign'],
    mutators: ['inbox:approval'],
    materializers: ['conversationMaterializer', 'internalNotesMaterializer'],
  },
  permissions: [],
  workspace: {
    owns: [{ kind: 'prefix', path: '/workspace/conversation/' }],
    frozenEager: [
      { kind: 'exact', path: '/workspace/conversation/messages.md' },
      { kind: 'exact', path: '/workspace/conversation/internal-notes.md' },
    ],
  },
  queues: ['snooze'],
}
