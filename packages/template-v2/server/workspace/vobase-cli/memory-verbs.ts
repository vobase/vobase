/**
 * Phase-1 stubs for `vobase memory …` subcommands.
 *
 * All verbs return exit code 0 with `"not-implemented in Phase 1"` so the
 * command is discoverable + lint-complete, but mutations are deferred to
 * Phase 2 where the markdown-section parser lands.
 */
import type { CommandDef } from '@server/common/port-types'

const NOT_IMPLEMENTED = 'not-implemented in Phase 1'

function stub(name: string, description: string, usage: string): CommandDef {
  return {
    name,
    description,
    usage,
    async execute() {
      return { ok: true, content: NOT_IMPLEMENTED }
    },
  }
}

export const memoryVerbs: readonly CommandDef[] = [
  stub(
    'memory set',
    'Upsert a markdown section in memory.',
    'vobase memory set <heading> <body> [--scope=contact|agent]',
  ),
  stub(
    'memory append',
    'Append a line to the default memory section.',
    'vobase memory append "<line>" [--scope=contact|agent]',
  ),
  stub(
    'memory remove',
    'Delete a named section from memory.',
    'vobase memory remove <heading> [--scope=contact|agent]',
  ),
  stub('memory view', 'Print full memory contents.', 'vobase memory view [--scope=contact|agent]'),
  stub('memory list', 'List section headings.', 'vobase memory list [--scope=contact|agent]'),
]
