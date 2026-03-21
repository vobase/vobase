import { createFileRoute } from '@tanstack/react-router';

import { Badge } from '@/components/ui/badge';

function MemoryPage() {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold">Memory</h2>
          <p className="text-sm text-muted-foreground">
            EverMemOS-inspired memory pipeline — episodes, facts, and hybrid
            retrieval
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-6">
          <h3 className="font-medium text-sm mb-1">Cells</h3>
          <p className="text-xs text-muted-foreground">
            Conversation segments detected by boundary detection. Each cell
            spans a contiguous range of messages.
          </p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <h3 className="font-medium text-sm mb-1">Episodes</h3>
          <p className="text-xs text-muted-foreground">
            Third-person narrative summaries of conversation segments. Embedded
            for semantic retrieval.
          </p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <h3 className="font-medium text-sm mb-1">Facts</h3>
          <p className="text-xs text-muted-foreground">
            Atomic facts extracted from conversations. Single sentences with
            explicit attribution.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-4">
        <Badge variant="outline">GET /api/ai/memory/stats</Badge>
        <Badge variant="outline">GET /api/ai/memory/search</Badge>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/ai/memory')({
  component: MemoryPage,
});
