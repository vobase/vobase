import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { GitBranchIcon, LayersIcon } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkflowRunDetail } from './-workflow-run-detail';
import type { WorkflowRun } from './-workflow-run-history';
import { WorkflowRunHistory } from './-workflow-run-history';
import { WorkflowStepTimeline } from './-workflow-step-timeline';

interface WorkflowStep {
  id: string;
  name: string;
  description: string;
  type: 'action' | 'suspend';
}

interface WorkflowMeta {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  stepCount: number;
  runCount: number;
}

async function fetchWorkflows(): Promise<{ workflows: WorkflowMeta[] }> {
  const res = await fetch('/api/ai/workflows/registry');
  if (!res.ok) throw new Error('Failed to fetch workflows');
  return res.json();
}

function WorkflowCard({
  workflow,
  onClick,
}: {
  workflow: WorkflowMeta;
  onClick: () => void;
}) {
  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-muted/50"
      onClick={onClick}
    >
      <CardContent>
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <GitBranchIcon className="size-4 text-primary" />
            </div>
            <p className="font-semibold text-sm">{workflow.name}</p>
          </div>
          <Badge variant="secondary" className="text-xs shrink-0">
            {workflow.stepCount} steps
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
          {workflow.description}
        </p>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <LayersIcon className="size-3" />
          <span>
            {workflow.runCount} {workflow.runCount === 1 ? 'run' : 'runs'}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkflowDetailSheet({
  workflow,
  open,
  onOpenChange,
}: {
  workflow: WorkflowMeta | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [selectedRun, setSelectedRun] = useState<WorkflowRun | null>(null);

  if (!workflow) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex flex-col gap-0 p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b px-6 py-4">
          <div className="flex items-center gap-3 pr-6">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <GitBranchIcon className="size-4 text-primary" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-sm">{workflow.name}</SheetTitle>
              <SheetDescription className="text-xs font-mono">
                {workflow.id}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="divide-y">
            {/* Step Timeline */}
            <div className="px-6 py-4">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Steps
              </h4>
              <WorkflowStepTimeline steps={workflow.steps} />
            </div>

            {/* Run History or Run Detail */}
            <div className="px-6 py-4">
              {selectedRun ? (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Run Detail
                    </h4>
                    <button
                      type="button"
                      onClick={() => setSelectedRun(null)}
                      className="text-xs text-primary hover:underline"
                    >
                      Back to history
                    </button>
                  </div>
                  <WorkflowRunDetail run={selectedRun} />
                </>
              ) : (
                <>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                    Run History
                  </h4>
                  <WorkflowRunHistory
                    workflowId={workflow.id}
                    onSelectRun={setSelectedRun}
                  />
                </>
              )}
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function WorkflowsPage() {
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowMeta | null>(
    null,
  );

  const { data, isLoading, isError } = useQuery({
    queryKey: ['workflows-registry'],
    queryFn: fetchWorkflows,
  });

  const workflows = data?.workflows ?? [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Workflows</h2>
        <p className="text-sm text-muted-foreground">
          Multi-step AI workflows with human-in-the-loop approval
        </p>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      )}

      {isError && (
        <p className="text-sm text-destructive text-center py-12">
          Failed to load workflows. Please try again.
        </p>
      )}

      {!isLoading && workflows.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-12">
          No workflows defined yet. Workflows are configured by your development
          team.
        </p>
      )}

      {workflows.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {workflows.map((workflow) => (
            <WorkflowCard
              key={workflow.id}
              workflow={workflow}
              onClick={() => setSelectedWorkflow(workflow)}
            />
          ))}
        </div>
      )}

      <WorkflowDetailSheet
        workflow={selectedWorkflow}
        open={!!selectedWorkflow}
        onOpenChange={(open) => {
          if (!open) setSelectedWorkflow(null);
        }}
      />
    </div>
  );
}

export const Route = createFileRoute('/_app/ai/workflows')({
  component: WorkflowsPage,
});
