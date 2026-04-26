/**
 * Workspace file tree — `@pierre/trees`-driven view over the org's virtual
 * filesystem. Fetches the path list from `/api/agents/workspace/tree`, hands
 * it to `useFileTree`, and forwards selection changes to the tab strip in
 * `workspace-layout.tsx` via the library's `onSelectionChange` callback.
 *
 * The library owns: keyboard navigation, expand/collapse, virtualization,
 * search (`hide-non-matches`), drag-and-drop. We don't reimplement any of
 * those; the only seam we own is `onSelectionChange → openTab(...)`.
 *
 * Paths from the backend start with `/` (POSIX-style). `@pierre/trees` treats
 * the leading slash as an empty root segment and renders an unlabeled root
 * node, so we strip it before feeding to `useFileTree` and prepend it back
 * when emitting `onOpen`.
 */

import { FileTree, useFileTree } from '@pierre/trees/react'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import { useActiveOrganizationId } from '@/hooks/use-current-user'
import { agentsClient } from '@/lib/api-client'
import { resolveTabForPath, type TabKind } from '@/lib/workspace-tabs'

export interface WorkspaceTreeProps {
  /** Called when the staff selects a path in the tree — drives the tabs reducer. */
  onOpen: (input: { kind: TabKind; path: string; label: string }) => void
}

interface WorkspaceTreeData {
  paths: string[]
  truncated: boolean
  total: number
}

async function fetchWorkspaceTree(organizationId: string): Promise<WorkspaceTreeData> {
  const r = await agentsClient.workspace.tree.$get({ query: { organizationId } })
  if (!r.ok) throw new Error('workspace tree fetch failed')
  return (await r.json()) as WorkspaceTreeData
}

export function WorkspaceTree({ onOpen }: WorkspaceTreeProps) {
  const organizationId = useActiveOrganizationId()
  const { data, isLoading, error } = useQuery({
    queryKey: ['workspace', 'tree', organizationId],
    queryFn: () => fetchWorkspaceTree(organizationId ?? ''),
    enabled: !!organizationId,
    staleTime: 30_000,
  })

  const treePaths = useMemo(() => (data?.paths ?? []).map((p) => p.replace(/^\//, '')), [data])

  const onSelectionChange = useCallback(
    (selectedPaths: readonly string[]) => {
      if (selectedPaths.length !== 1) return
      const path = selectedPaths[0]
      if (!path || path.endsWith('/')) return // directory clicks just expand
      const fullPath = path.startsWith('/') ? path : `/${path}`
      const { kind, label } = resolveTabForPath(fullPath)
      onOpen({ kind, path: fullPath, label })
    },
    [onOpen],
  )

  const { model } = useFileTree({
    paths: treePaths,
    fileTreeSearchMode: 'hide-non-matches',
    onSelectionChange,
  })

  if (isLoading) {
    return <div className="p-3 text-muted-foreground text-xs">Loading tree…</div>
  }
  if (error) {
    return <div className="p-3 text-destructive text-xs">Failed to load tree.</div>
  }
  if (treePaths.length === 0) {
    return <div className="p-3 text-muted-foreground text-xs">No paths yet.</div>
  }

  return <FileTree model={model} className="size-full text-sm" />
}
