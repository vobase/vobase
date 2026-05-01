import {
  type AgentDefinitionRow,
  useAgentDefinitions,
  useCreateAgent,
  useDeleteAgent,
  useUpdateAgent,
} from '@modules/agents/hooks/use-agent-definitions'
import { DEFAULT_CHAT_MODEL, MODEL_OPTIONS } from '@modules/agents/lib/models'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Bot, MoreVertical, Plus, Sparkles } from 'lucide-react'
import { useState } from 'react'

import { PageBody, PageHeader, PageLayout } from '@/components/layout/page-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

function AgentCard({ agent }: { agent: AgentDefinitionRow }) {
  const update = useUpdateAgent(agent.id)
  const remove = useDeleteAgent()
  return (
    <div className="group relative flex flex-col rounded-xl border bg-card p-4 transition-colors hover:bg-accent/30">
      <Link
        to="/agents/$id"
        params={{ id: agent.id }}
        className="absolute inset-0 rounded-xl"
        aria-label={`Open ${agent.name}`}
      />
      <div className="flex items-start justify-between">
        <div className="flex size-9 items-center justify-center rounded-md bg-muted">
          <Bot className="size-5 text-muted-foreground" />
        </div>
        <div className="relative z-10 flex items-center gap-2">
          <Switch checked={agent.enabled} onCheckedChange={(v) => update.mutate({ enabled: v })} aria-label="Enabled" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7">
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to="/agents/$id" params={{ id: agent.id }}>
                  Edit
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => update.mutate({ enabled: !agent.enabled })}>
                {agent.enabled ? 'Disable' : 'Enable'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onSelect={() => {
                  if (confirm(`Delete agent "${agent.name}"? This cannot be undone.`)) remove.mutate(agent.id)
                }}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="mt-3">
        <p className="truncate font-medium text-sm">{agent.name}</p>
        <p className="truncate font-mono text-muted-foreground text-xs">{agent.model}</p>
      </div>
      <div className="mt-3">
        <Badge variant={agent.enabled ? 'default' : 'secondary'} className="text-xs">
          {agent.enabled ? 'active' : 'disabled'}
        </Badge>
      </div>
    </div>
  )
}

function NewAgentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate()
  const create = useCreateAgent()
  const [name, setName] = useState('')
  const [model, setModel] = useState<string>(MODEL_OPTIONS[0]?.value ?? DEFAULT_CHAT_MODEL)

  function reset() {
    setName('')
    setModel(MODEL_OPTIONS[0]?.value ?? DEFAULT_CHAT_MODEL)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) reset()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New agent</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-agent-name">Name</Label>
            <Input
              id="new-agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Support Agent"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-agent-model">Model</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger id="new-agent-model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {create.isError && (
            <p className="text-destructive text-xs">
              {create.error instanceof Error ? create.error.message : 'Failed to create agent'}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              const row = (await create.mutateAsync({ name: name.trim(), model })) as { id: string }
              onOpenChange(false)
              reset()
              navigate({ to: '/agents/$id', params: { id: row.id } })
            }}
            disabled={!name.trim() || create.isPending}
          >
            {create.isPending ? 'Creating…' : 'Create agent'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AgentsListPage() {
  const { data: agents = [], isLoading } = useAgentDefinitions()
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <PageLayout>
      <PageHeader
        title="Agents"
        description="Agents configured for this organization. Toggle them on or off, or open one to edit."
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <Link to="/changes">
                <Sparkles className="mr-1 size-4" />
                Changes
              </Link>
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 size-4" />
              New agent
            </Button>
          </>
        }
      />
      <PageBody>
        {isLoading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : agents.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia>
                <Bot className="size-5" />
              </EmptyMedia>
              <EmptyTitle>No agents yet</EmptyTitle>
              <EmptyDescription>Create your first agent to start handling inbound conversations.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </PageBody>

      <NewAgentDialog open={createOpen} onOpenChange={setCreateOpen} />
    </PageLayout>
  )
}

export const Route = createFileRoute('/_app/agents/')({
  component: AgentsListPage,
})
