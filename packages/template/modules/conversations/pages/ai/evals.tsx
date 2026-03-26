import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  ClockIcon,
  FlaskConicalIcon,
  LoaderIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// ─── Types ────────────────────────────────────────────────────────────

interface EvalRun {
  id: string;
  agentId: string | null;
  status: string;
  results: unknown;
  errorMessage: string | null;
  itemCount: number;
  createdAt: string;
  completedAt: string | null;
}

interface ParsedScores {
  answerRelevancy?: number;
  faithfulness?: number;
}

// ─── Data ─────────────────────────────────────────────────────────────

async function fetchEvalRuns(): Promise<EvalRun[]> {
  const res = await globalThis.fetch('/api/ai/evals');
  if (!res.ok) throw new Error('Failed to fetch eval runs');
  return res.json();
}

// ─── Helpers ──────────────────────────────────────────────────────────

function parseScores(results: unknown): ParsedScores {
  if (!results || typeof results !== 'object') return {};
  try {
    const items = Array.isArray(results) ? results : [];
    if (items.length === 0) return {};

    let relevancySum = 0;
    let faithfulnessSum = 0;
    let relevancyCount = 0;
    let faithfulnessCount = 0;

    for (const item of items) {
      const scores =
        typeof item === 'object' && item !== null && 'scores' in item
          ? (item as { scores: Record<string, number> }).scores
          : {};
      if (typeof scores.answerRelevancy === 'number') {
        relevancySum += scores.answerRelevancy;
        relevancyCount++;
      }
      if (typeof scores.faithfulness === 'number') {
        faithfulnessSum += scores.faithfulness;
        faithfulnessCount++;
      }
    }

    return {
      answerRelevancy:
        relevancyCount > 0 ? relevancySum / relevancyCount : undefined,
      faithfulness:
        faithfulnessCount > 0 ? faithfulnessSum / faithfulnessCount : undefined,
    };
  } catch {
    return {};
  }
}

function statusIcon(status: string) {
  if (status === 'complete')
    return <CheckCircle2Icon className="h-3.5 w-3.5 text-green-600" />;
  if (status === 'error')
    return <CircleAlertIcon className="h-3.5 w-3.5 text-destructive" />;
  if (status === 'running')
    return <LoaderIcon className="h-3.5 w-3.5 text-blue-500 animate-spin" />;
  return <ClockIcon className="h-3.5 w-3.5 text-muted-foreground" />;
}

function statusVariant(
  status: string,
): 'default' | 'secondary' | 'outline' | 'success' | 'destructive' {
  if (status === 'complete') return 'success';
  if (status === 'error') return 'destructive';
  if (status === 'running') return 'default';
  return 'secondary';
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Page ─────────────────────────────────────────────────────────────

function EvalsPage() {
  const {
    data: runs = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['eval-runs'],
    queryFn: fetchEvalRuns,
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Evals</h2>
        <p className="text-sm text-muted-foreground">
          Evaluation runs that score AI agent responses for quality and
          faithfulness
        </p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">
            Failed to load eval runs. The evals API may not be available.
          </p>
        </div>
      )}

      {!isLoading && !isError && runs.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center">
            <FlaskConicalIcon className="mx-auto h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium mb-1">No eval runs yet</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto mb-4">
              Eval runs score AI agent responses for answer relevancy and
              faithfulness. Trigger a run via the API.
            </p>
            <div className="flex items-center justify-center gap-2">
              <Badge variant="outline" className="text-xs">
                POST /api/ai/evals/run
              </Badge>
              <Badge variant="outline" className="text-xs">
                GET /api/ai/evals/:runId
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {runs.length > 0 && (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  Status
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  AI Agent
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  Items
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  Relevancy
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  Faithfulness
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const scores = parseScores(run.results);
                return (
                  <tr
                    key={run.id}
                    className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {statusIcon(run.status)}
                        <Badge
                          variant={statusVariant(run.status)}
                          className="text-[10px] capitalize"
                        >
                          {run.status}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {run.agentId ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {run.itemCount}
                    </td>
                    <td className="px-3 py-2.5">
                      <ScoreCell value={scores.answerRelevancy} />
                    </td>
                    <td className="px-3 py-2.5">
                      <ScoreCell value={scores.faithfulness} />
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {formatDateTime(run.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ScoreCell({ value }: { value: number | undefined }) {
  if (value === undefined) {
    return <span className="text-muted-foreground/40">—</span>;
  }
  const pct = value * 100;
  const color =
    pct >= 80
      ? 'text-green-600'
      : pct >= 60
        ? 'text-yellow-600'
        : 'text-red-600';
  return (
    <span className={`text-xs font-medium ${color}`}>{pct.toFixed(0)}%</span>
  );
}

export const Route = createFileRoute('/_app/conversations/ai/evals')({
  component: EvalsPage,
});
