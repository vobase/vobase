/**
 * Workspace layout — three-pane shell for the Workspace surface (§9.1):
 *
 *   ┌──────┬──────────────────────────┬───────┐
 *   │ Tree │ Tabs strip + active body │ Right │
 *   │      │                          │ rail  │
 *   └──────┴──────────────────────────┴───────┘
 *
 * Left: `<WorkspaceTree />` over `useFileTree` from `@pierre/trees`. Center:
 * tab strip + the active tab's content pane. Right: operator chat — pinned to
 * the active `chat` tab if one is open, otherwise falls back to the staff's
 * most recent thread so the rail is never blank when threads exist.
 */

import { OperatorChat } from '@modules/agents/components/operator-chat'
import { parseOperatorChatPath } from '@modules/agents/service/synthetic-ids'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback } from 'react'

import { useActiveOrganizationId, useCurrentUserId } from '@/hooks/use-current-user'
import { agentsClient } from '@/lib/api-client'
import { usePersistedWorkspaceTabs } from '@/lib/use-persisted-workspace-tabs'
import type { TabKind } from '@/lib/workspace-tabs'
import { WorkspaceDocumentPane } from './workspace-document-pane'
import { WorkspaceTabStrip } from './workspace-tab-strip'
import { WorkspaceTree } from './workspace-tree'

export const Route = createFileRoute('/_app/workspace')({
  component: WorkspaceLayout,
})

async function fetchMostRecentThreadId(organizationId: string): Promise<string | null> {
  const r = await agentsClient.threads.$get({ query: { organizationId } })
  if (!r.ok) return null
  const body = await r.json()
  return body.rows[0]?.id ?? null
}

function WorkspaceLayout() {
  const staffId = useCurrentUserId()
  const organizationId = useActiveOrganizationId()
  const [state, dispatch] = usePersistedWorkspaceTabs(staffId)
  const onOpen = useCallback(
    (input: { kind: TabKind; path: string; label: string }) => {
      dispatch({ type: 'open', tab: input })
    },
    [dispatch],
  )
  const activeTab = state.tabs.find((t) => t.id === state.activeTabId)
  const activeChatThreadId = activeTab?.kind === 'chat' ? parseOperatorChatPath(activeTab.path) : null

  const { data: fallbackThreadId } = useQuery({
    queryKey: ['operator-threads', 'most-recent', organizationId],
    queryFn: () => fetchMostRecentThreadId(organizationId ?? ''),
    enabled: !!organizationId && !activeChatThreadId,
    staleTime: 30_000,
  })

  const railThreadId = activeChatThreadId ?? fallbackThreadId ?? null

  return (
    <div className="grid h-full grid-cols-[260px_1fr_320px] overflow-hidden">
      <aside className="border-r">
        <WorkspaceTree onOpen={onOpen} />
      </aside>
      <section className="flex h-full flex-col overflow-hidden">
        <WorkspaceTabStrip state={state} dispatch={dispatch} />
        <div className="flex-1 overflow-auto p-4 text-sm">
          {activeChatThreadId && organizationId ? (
            <div className="h-full">
              <OperatorChat threadId={activeChatThreadId} organizationId={organizationId} />
            </div>
          ) : activeTab && organizationId && activeTab.kind === 'document' ? (
            <WorkspaceDocumentPane path={activeTab.path} organizationId={organizationId} />
          ) : activeTab ? (
            <div className="space-y-2">
              <div className="text-muted-foreground text-xs uppercase">{activeTab.kind}</div>
              <div className="font-mono text-xs">{activeTab.path}</div>
              <p className="text-muted-foreground">No preview yet for this kind of resource.</p>
            </div>
          ) : (
            <div className="text-muted-foreground">Select a path in the tree to open it as a tab.</div>
          )}
        </div>
      </section>
      <aside className="border-l">
        <RightRail threadId={railThreadId} organizationId={organizationId} />
      </aside>
    </div>
  )
}

function RightRail({ threadId, organizationId }: { threadId: string | null; organizationId: string | null }) {
  if (!threadId || !organizationId) {
    return (
      <div className="p-3 text-muted-foreground text-xs">
        <p>No operator chats yet — start one from the tree.</p>
      </div>
    )
  }
  return <OperatorChat threadId={threadId} organizationId={organizationId} variant="compact" />
}
