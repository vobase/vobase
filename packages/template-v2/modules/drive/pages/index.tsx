import { createFileRoute } from '@tanstack/react-router'
import { FileText, FolderTree, HardDrive, Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function DrivePage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <HardDrive className="size-5 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Drive</h1>
            <p className="text-sm text-muted-foreground">
              Virtual file tree — organization-scope policy docs and per-contact uploads.
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FolderTree className="size-4" />
                Organization scope
              </CardTitle>
              <CardDescription>Brand, policy, pricing docs — read-only to the agent.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
                <div className="flex items-center gap-2">
                  <FileText className="size-3.5 text-muted-foreground" />
                  <span>/BUSINESS.md</span>
                  <Badge variant="secondary" className="ml-auto font-normal">
                    seeded
                  </Badge>
                </div>
                <p className="mt-2 text-muted-foreground">
                  Injected into the frozen system prompt at agent_start. Overwrites require a staff-approved proposal.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FolderTree className="size-4" />
                Contact scope
              </CardTitle>
              <CardDescription>Per-customer uploads and notes. Agent is read-write.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Files auto-file under{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">contact:/uploads/</code> as customers
              send media. Captions arrive asynchronously via the Gemini pipeline.
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Info className="size-4" />
                Proposal flow
              </CardTitle>
              <CardDescription>How agents propose changes to organization-scope files.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <ol className="list-decimal space-y-1 pl-5">
                <li>
                  Agent runs{' '}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    vobase drive propose --path /BUSINESS.md
                  </code>
                  .
                </li>
                <li>
                  A <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">learning_proposals</code> row lands
                  in the <Badge variant="secondary">Drive doc</Badge> scope queue.
                </li>
                <li>
                  Staff reviews on the{' '}
                  <a className="text-foreground underline-offset-2 hover:underline" href="/agents/learnings">
                    Learnings page
                  </a>
                  .
                </li>
                <li>Approval applies the write; rejection stores the reason as an anti-lesson.</li>
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_app/drive/')({
  component: DrivePage,
})
