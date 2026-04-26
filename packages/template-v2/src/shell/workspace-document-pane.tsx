/**
 * Document renderer for workspace tabs whose path resolves to a markdown or
 * yaml-flavoured virtual file (`/INDEX.md`, `/agents/<id>/AGENTS.md`,
 * `/contacts/<id>/profile.md`, `/views/<scope>/<slug>.view.yaml`, …).
 *
 * Backend lookup is `GET /api/agents/workspace/file?path=...` — supported
 * paths return `{ path, content }`; anything else 404s and we fall back to
 * a "preview not available" hint.
 */

import { useQuery } from '@tanstack/react-query'

import { MessageResponse } from '@/components/ai-elements/message'
import { agentsClient } from '@/lib/api-client'

interface WorkspaceFile {
  path: string
  content: string
}

async function fetchWorkspaceFile(path: string, organizationId: string): Promise<WorkspaceFile | null> {
  const r = await agentsClient.workspace.file.$get({ query: { path, organizationId } })
  if (r.status === 404) return null
  if (!r.ok) throw new Error('workspace file fetch failed')
  return (await r.json()) as WorkspaceFile
}

export function WorkspaceDocumentPane({ path, organizationId }: { path: string; organizationId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['workspace', 'file', organizationId, path],
    queryFn: () => fetchWorkspaceFile(path, organizationId),
    staleTime: 10_000,
  })

  if (isLoading) return <div className="p-3 text-muted-foreground text-xs">Loading…</div>
  if (error) return <div className="p-3 text-destructive text-xs">Failed to load.</div>
  if (!data) {
    return (
      <div className="space-y-1 p-1 text-muted-foreground text-xs">
        <div className="font-mono">{path}</div>
        <p>Preview not available for this path yet.</p>
      </div>
    )
  }

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <MessageResponse>{data.content}</MessageResponse>
    </div>
  )
}
