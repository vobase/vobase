/**
 * <AgentViewPane scope={...} /> — collapsible pane that renders the
 * materialized files an agent sees for a given scope (contact, agent, or
 * staff). The endpoint is module-typed, returning `{ scope, files: [{ path,
 * title, content }] }`. Each file is its own collapsible section.
 *
 * Per-scope endpoints (mounted in §9):
 *   /contacts/<id>            → /api/contacts/:id/agent-view
 *   /agents/<id>              → /api/agents/:id/agent-view
 *   /staff/<id>               → /api/team/staff/:userId/agent-view
 */

import type { AgentViewFile, AgentViewResponse } from '@modules/contacts/handlers/agent-view'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Eye, FileText } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { agentsClient, contactsClient, teamClient } from '@/lib/api-client'

export interface AgentViewPaneProps {
  /** URL-shaped scope path, e.g. `/contacts/cnt_…`, `/agents/agt_…`, `/staff/usr_…`. */
  scope: string
  /** Optional collapsed-by-default state for the entire pane. */
  defaultOpen?: boolean
}

async function fetchAgentView(scope: string): Promise<AgentViewResponse> {
  const m = scope.match(/^\/(contacts|agents|staff)\/([^/]+)$/u)
  if (!m) throw new Error(`Unsupported agent-view scope: ${scope}`)
  const [, kind, id] = m as unknown as [string, 'contacts' | 'agents' | 'staff', string]
  const r = await runFetch(kind, id)
  if (!r.ok) throw new Error(`Failed to load agent view (${r.status})`)
  return (await r.json()) as AgentViewResponse
}

function runFetch(kind: 'contacts' | 'agents' | 'staff', id: string): Promise<Response> {
  if (kind === 'contacts') {
    return contactsClient[':id']['agent-view'].$get({ param: { id } })
  }
  if (kind === 'agents') {
    return agentsClient[':id']['agent-view'].$get({ param: { id } })
  }
  return teamClient.staff[':userId']['agent-view'].$get({ param: { userId: id } })
}

function AgentViewFileEntry({ file }: { file: AgentViewFile }) {
  const [open, setOpen] = useState(false)
  const Icon = open ? ChevronDown : ChevronRight
  return (
    <div className="border-border border-b last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40"
      >
        <Icon className="size-3.5 text-muted-foreground" />
        <FileText className="size-3.5 text-muted-foreground" />
        <span className="truncate font-mono text-xs">{file.title}</span>
        <span className="ml-auto shrink-0 text-muted-foreground text-xs">{file.content.length} bytes</span>
      </button>
      {open && (
        <pre className="max-h-96 overflow-auto border-border border-t bg-muted/30 px-4 py-3 font-mono text-xs leading-relaxed">
          {file.content}
        </pre>
      )}
    </div>
  )
}

export function AgentViewPane({ scope, defaultOpen = false }: AgentViewPaneProps) {
  const [open, setOpen] = useState(defaultOpen)
  const { data, isLoading, error } = useQuery({
    queryKey: ['agent-view', scope],
    queryFn: () => fetchAgentView(scope),
    enabled: open,
  })
  const Icon = open ? ChevronDown : ChevronRight
  return (
    <section className="rounded-md border border-border">
      <header className="flex items-center gap-2 px-3 py-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} className="-ml-2 h-7 gap-1.5 px-2">
          <Icon className="size-3.5" />
          <Eye className="size-3.5" />
          <span className="text-sm">Agent View</span>
        </Button>
        <span className="text-muted-foreground text-xs">What the agent sees about this {scopeLabel(scope)}.</span>
      </header>
      {open && (
        <div className="border-border border-t">
          {isLoading && <div className="px-4 py-3 text-muted-foreground text-xs">Loading…</div>}
          {error && (
            <div className="px-4 py-3 text-destructive text-xs">
              {error instanceof Error ? error.message : String(error)}
            </div>
          )}
          {data && data.files.length === 0 && (
            <Empty className="py-8">
              <EmptyHeader>
                <EmptyMedia>
                  <FileText className="size-5" />
                </EmptyMedia>
                <EmptyTitle>No materialized files yet</EmptyTitle>
                <EmptyDescription>
                  The agent has no observations for this {scopeLabel(scope)}. Files appear after the next wake.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {data && data.files.length > 0 && (
            <div>
              {data.files.map((file) => (
                <AgentViewFileEntry key={file.path} file={file} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function scopeLabel(scope: string): string {
  if (scope.startsWith('/contacts/')) return 'contact'
  if (scope.startsWith('/agents/')) return 'agent'
  if (scope.startsWith('/staff/')) return 'staff member'
  return 'record'
}
