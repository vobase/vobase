import { AgentsMdEditor } from '@modules/agents/components/agents-md-editor'
import { useAgentDefinition, useDeleteAgent, useUpdateAgent } from '@modules/agents/hooks/use-agent-definitions'
import { MODEL_OPTIONS } from '@modules/agents/service/agent-definitions'
import { DriveBrowser } from '@modules/drive/components/drive-browser'
import { DriveProvider } from '@modules/drive/components/drive-provider'
import { createFileRoute, Link, useNavigate, useParams } from '@tanstack/react-router'
import { ArrowLeft, Bot, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { AgentViewPane } from '@/components/agent-view-pane'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'

function AgentDetailPage() {
  const { id } = useParams({ from: '/_app/agents/$id' })
  const navigate = useNavigate()
  const { data: agent, isLoading, isError } = useAgentDefinition(id)
  const update = useUpdateAgent(id)
  const remove = useDeleteAgent()

  const [name, setName] = useState('')
  const [model, setModel] = useState('')
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    if (!agent) return
    setName(agent.name)
    setModel(agent.model)
    setEnabled(agent.enabled)
  }, [agent])

  const settingsDirty = !!agent && (name !== agent.name || model !== agent.model || enabled !== agent.enabled)

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (isError || !agent) {
    return (
      <Empty className="m-6 border">
        <EmptyHeader>
          <EmptyTitle>Agent not found</EmptyTitle>
          <EmptyDescription>
            <Link to="/agents" className="hover:text-primary">
              Back to agents
            </Link>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-3 border-border border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/agents">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="flex size-9 items-center justify-center rounded-md bg-muted">
            <Bot className="size-5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="font-semibold text-lg tracking-tight">{agent.name}</h1>
            <p className="font-mono text-muted-foreground text-xs">{agent.model}</p>
          </div>
          <Badge variant={agent.enabled ? 'default' : 'secondary'} className="ml-2">
            {agent.enabled ? 'active' : 'disabled'}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => {
            if (confirm(`Delete agent "${agent.name}"? This cannot be undone.`)) {
              remove.mutate(agent.id, { onSuccess: () => navigate({ to: '/agents' }) })
            }
          }}
        >
          <Trash2 className="mr-1.5 size-3.5" />
          Delete
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <section className="shrink-0 border-border border-b px-6 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium text-sm">Settings</h2>
            <div className="flex items-center gap-2">
              <Label htmlFor="agent-enabled" className="text-muted-foreground text-xs">
                Enabled
              </Label>
              <Switch id="agent-enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="agent-name">Name</Label>
              <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agent-model">Model</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger id="agent-model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                  {MODEL_OPTIONS.every((o) => o.value !== agent.model) && (
                    <SelectItem value={agent.model}>{agent.model}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-muted-foreground text-xs">
              {update.isError ? (
                <span className="text-destructive">Failed to save changes.</span>
              ) : update.isSuccess && !settingsDirty ? (
                'Saved.'
              ) : (
                ' '
              )}
            </p>
            <Button
              size="sm"
              onClick={() => update.mutate({ name, model, enabled })}
              disabled={!settingsDirty || update.isPending}
            >
              <Save className="mr-1.5 size-3.5" />
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </section>

        <section className="shrink-0 border-border border-b px-6 py-4">
          <AgentViewPane scope={`/agents/${agent.id}`} />
        </section>

        <section className="flex min-h-0 flex-1 flex-col">
          <DriveProvider
            scope={{ scope: 'agent', agentId: agent.id }}
            rootLabel={`${agent.name}'s files`}
            initialPath="/AGENTS.md"
            renderPreview={({ path, content }) => {
              if (path === '/AGENTS.md') {
                return <AgentsMdEditor agentId={agent.id} agentName={agent.name} initialInstructions={content} />
              }
              return null
            }}
          >
            <DriveBrowser />
          </DriveProvider>
        </section>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_app/agents/$id')({
  component: AgentDetailPage,
})
