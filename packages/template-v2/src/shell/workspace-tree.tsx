/**
 * Workspace file tree — `@pierre/trees`-driven view over the org's virtual
 * filesystem. Fetches the path list from `/api/agents/workspace/tree`, hands
 * it to `useFileTree`, and listens for selection changes to drive the tab
 * strip in `workspace-layout.tsx`.
 *
 * The library owns: keyboard navigation, expand/collapse, virtualization,
 * search (`hide-non-matches`), drag-and-drop. We don't reimplement any of
 * those; the only seam we own is `onSelect → openTab(...)`.
 *
 * Paths from the backend start with `/` (POSIX-style). `@pierre/trees` treats
 * the leading slash as an empty root segment and renders an unlabeled root
 * node, so we strip it before feeding to `useFileTree` and prepend it back
 * when emitting `onOpen`.
 */

import { parseOperatorChatPath, parseOperatorSchedulePath } from '@modules/agents/service/synthetic-ids'
import { FileTree, useFileTree, useFileTreeSelection } from '@pierre/trees/react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'

import { useActiveOrganizationId } from '@/hooks/use-current-user'
import { agentsClient } from '@/lib/api-client'
import type { TabKind } from '@/lib/workspace-tabs'

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

/**
 * Map a virtual-fs path to a `TabKind`. The tabs reducer (`workspace-tabs.ts`)
 * dedupes by path so this mapping must be deterministic.
 */
function tabKindForPath(path: string): TabKind {
  if (path === '/INDEX.md' || path.endsWith('.md') || path.endsWith('.view.yaml')) return 'document'
  if (parseOperatorChatPath(path) !== null) return 'chat'
  if (parseOperatorSchedulePath(path) !== null) return 'schedule'
  if (path === '/contacts/' || path === '/agents/' || path === '/drive/') return 'object-list'
  return 'entry'
}

/** Friendly label for a path: last segment, with a few tweaks for synthetic paths. */
function labelForPath(path: string): string {
  const chatId = parseOperatorChatPath(path)
  if (chatId !== null) return `Chat: ${chatId}`
  const scheduleId = parseOperatorSchedulePath(path)
  if (scheduleId !== null) return `Schedule: ${scheduleId}`
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
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

  const { model } = useFileTree({
    paths: treePaths,
    fileTreeSearchMode: 'hide-non-matches',
  })

  const selection = useFileTreeSelection(model)
  // The hook exposes a Set-like collection of selected paths. When the
  // selection becomes a single concrete path, treat that as a `tab open`
  // intent.
  useEffect(() => {
    if (!selection) return
    const selectedPaths = Array.isArray(selection) ? selection : Array.from(selection as Iterable<string>)
    if (selectedPaths.length !== 1) return
    const path = selectedPaths[0]
    if (!path || path.endsWith('/')) return // directory clicks just expand
    const fullPath = path.startsWith('/') ? path : `/${path}`
    onOpen({ kind: tabKindForPath(fullPath), path: fullPath, label: labelForPath(fullPath) })
  }, [selection, onOpen])

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
