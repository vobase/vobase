/**
 * Agent-facing surfaces for the views module.
 *
 * Materializers render the agent's view of saved views as virtual yaml files
 * under `/views/<scope>/<slug>.view.yaml`. These are read-only — agents save
 * views via the `save_view` tool, not by editing the materialized file.
 *
 * The factory is wake-time so it can scope the view list to the wake's
 * accessible viewables.
 */

import type { SavedViewRow } from '@modules/views/schema'
import { list as listViews } from '@modules/views/service/views'
import { serializeYaml, type WorkspaceMaterializer } from '@vobase/core'

export interface ViewsMaterializerOpts {
  /**
   * Which viewable scopes this wake has access to. The materializer only
   * surfaces saved views whose `scope` is in this list. Empty = no views.
   */
  scopes: readonly string[]
}

export async function buildViewsMaterializers(opts: ViewsMaterializerOpts): Promise<WorkspaceMaterializer[]> {
  if (!opts.scopes.length) return []
  const uniqueScopes = [...new Set(opts.scopes)]
  const perScope = await Promise.all(uniqueScopes.map((scope) => listViews(scope).then((rows) => ({ scope, rows }))))
  const materializers: WorkspaceMaterializer[] = []
  for (const { scope, rows } of perScope) {
    for (const row of rows) {
      materializers.push({
        path: `/views/${scope}/${row.slug}.view.yaml`,
        phase: 'on-read',
        materialize: () => renderRow(row),
      })
    }
  }
  return materializers
}

function renderRow(row: SavedViewRow): string {
  // The agent reads exactly the body shape, plus an inline provenance
  // comment so they know whether a view came from the source repo or from
  // a runtime save. The provenance line is `#`-prefixed so it round-trips
  // through Bun.YAML.parse as a no-op.
  const provenance = `# origin: ${row.origin}${row.fileSourcePath ? ` (source: ${row.fileSourcePath})` : ''}`
  return `${provenance}\n${serializeYaml(row.body)}`
}
