import { createFileRoute, Link } from '@tanstack/react-router'
import { Bot, Brain, ChevronRight, FileCheck2, Shield } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface AgentSummary {
  id: string
  name: string
  model: string
  description: string
  status: 'active' | 'disabled'
  icon: React.ElementType
  links: { label: string; to: '/agents/learnings' | '/inbox/approvals'; icon: React.ElementType }[]
}

const AGENTS: AgentSummary[] = [
  {
    id: 'meridian',
    name: 'Meridian',
    model: 'claude-sonnet-4-6',
    description:
      'The default customer-facing agent for this tenant. Handles inbound messages, proposes learnings, and routes approvals to staff.',
    status: 'active',
    icon: Bot,
    links: [
      { label: 'Learnings', to: '/agents/learnings', icon: Brain },
      { label: 'Approvals', to: '/inbox/approvals', icon: FileCheck2 },
    ],
  },
]

export function AgentsListPage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Agents</h1>
        <p className="text-sm text-muted-foreground">
          Agents configured for this tenant, their model, and review queues.
        </p>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {AGENTS.map((agent) => {
            const Icon = agent.icon
            return (
              <Card key={agent.id} className="flex flex-col">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-md bg-muted">
                        <Icon className="size-5 text-muted-foreground" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{agent.name}</CardTitle>
                        <CardDescription className="font-mono text-xs">{agent.model}</CardDescription>
                      </div>
                    </div>
                    <Badge variant={agent.status === 'active' ? 'default' : 'secondary'}>{agent.status}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col justify-between gap-4">
                  <p className="text-sm text-muted-foreground">{agent.description}</p>
                  <div className="flex flex-col gap-1.5">
                    {agent.links.map((link) => {
                      const LinkIcon = link.icon
                      return (
                        <Link
                          key={link.to}
                          to={link.to}
                          className="group flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:bg-accent"
                        >
                          <span className="inline-flex items-center gap-2">
                            <LinkIcon className="size-4 text-muted-foreground" />
                            {link.label}
                          </span>
                          <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground" />
                        </Link>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            )
          })}

          <Card className="border-dashed">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-md bg-muted">
                  <Shield className="size-5 text-muted-foreground" />
                </div>
                <div>
                  <CardTitle className="text-base">Add an agent</CardTitle>
                  <CardDescription>Future: define a second agent alongside Meridian.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Agent configuration currently ships via{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">modules/agents/seed.ts</code>.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_app/agents/')({
  component: AgentsListPage,
})
