import { createFileRoute } from '@tanstack/react-router';

import { Badge } from '@/components/ui/badge';

function EvalsPage() {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold">Evals</h2>
          <p className="text-sm text-muted-foreground">
            Run evaluation scorers against agent responses to measure quality
          </p>
        </div>
      </div>
      <div className="rounded-lg border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground mb-2">
          Eval runs score agent responses using LLM judges for answer relevancy
          and faithfulness.
        </p>
        <div className="flex items-center justify-center gap-2 mt-4">
          <Badge variant="outline">POST /api/ai/evals/run</Badge>
          <Badge variant="outline">GET /api/ai/evals/:runId</Badge>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/ai/evals')({
  component: EvalsPage,
});
