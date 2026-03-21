import { createFileRoute } from '@tanstack/react-router';

import { Badge } from '@/components/ui/badge';

function WorkflowsPage() {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold">Workflows</h2>
          <p className="text-sm text-muted-foreground">
            Orchestrate multi-step AI workflows with human-in-the-loop approval
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border bg-card p-6">
          <h3 className="font-medium text-sm mb-1">Escalation</h3>
          <p className="text-xs text-muted-foreground mb-3">
            HITL workflow — suspends for human approval, then executes the
            decision.
          </p>
          <div className="flex gap-2">
            <Badge variant="outline">POST /api/ai/workflows/escalation/start</Badge>
            <Badge variant="outline">resume</Badge>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <h3 className="font-medium text-sm mb-1">Follow-up</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Delayed workflow — schedules a follow-up message after a configurable
            delay.
          </p>
          <div className="flex gap-2">
            <Badge variant="outline">POST /api/ai/workflows/follow-up/start</Badge>
          </div>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/ai/workflows')({
  component: WorkflowsPage,
});
