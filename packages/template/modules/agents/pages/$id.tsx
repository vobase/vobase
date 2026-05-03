import { AgentsMdEditor } from '@modules/agents/components/agents-md-editor'
import { useAgentDefinition, useDeleteAgent, useUpdateAgent } from '@modules/agents/hooks/use-agent-definitions'
import { MODEL_OPTIONS } from '@modules/agents/lib/models'
import { DriveSection } from '@modules/drive/components/drive-section'
import { createFileRoute, Link, useNavigate, useParams } from '@tanstack/react-router'
import { Bot, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { InfoCard, InfoRow, InfoSection } from '@/components/info'
import { PageBody, PageHeader, PageLayout } from '@/components/layout/page-layout'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
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
    <PageLayout>
      <PageHeader
        title={agent.name}
        backTo={{ to: '/agents', label: 'Agents' }}
        icon={Bot}
        actions={
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
            <Trash2 />
            Delete
          </Button>
        }
      />

      <PageBody className="space-y-6">
        <InfoSection
          title="Settings"
          description="Identity, model selection, and runtime status."
          actions={
            <Button
              size="sm"
              onClick={() => update.mutate({ name, model, enabled })}
              disabled={!settingsDirty || update.isPending}
            >
              <Save />
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          }
        >
          <InfoCard>
            <InfoRow label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} className="max-w-[280px]" />
            </InfoRow>
            <InfoRow label="Model">
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="max-w-[280px]">
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
            </InfoRow>
            <InfoRow label="Enabled">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </InfoRow>
          </InfoCard>
          {update.isError && <p className="text-destructive text-xs">Failed to save changes.</p>}
        </InfoSection>

        <DriveSection
          scope={{ scope: 'agent', agentId: agent.id }}
          rootLabel={`${agent.name}'s files`}
          initialPath="/AGENTS.md"
          renderPreview={({ path, content }) => {
            if (path === '/AGENTS.md') {
              return <AgentsMdEditor agentId={agent.id} agentName={agent.name} initialInstructions={content} />
            }
            return null
          }}
        />
      </PageBody>
    </PageLayout>
  )
}

export const Route = createFileRoute('/_app/agents/$id')({
  component: AgentDetailPage,
})
