import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  ClockIcon,
  FlaskConicalIcon,
  LoaderIcon,
  ZapIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { aiClient } from '@/lib/api-client';

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

interface ScorerMeta {
  id: string;
  name: string;
  description: string;
  hasJudge: boolean;
  steps: Array<{ name: string; type: string; description?: string }>;
}

interface LiveScore {
  id: string;
  scorerId: string;
  score: number;
  reason?: string;
  createdAt: string;
  agentId?: string;
}

// ─── Data ─────────────────────────────────────────────────────────────

async function fetchEvalRuns(): Promise<EvalRun[]> {
  const res = await aiClient.evals.$get();
  if (!res.ok) throw new Error('Failed to fetch eval runs');
  return res.json();
}

async function fetchScorers(): Promise<ScorerMeta[]> {
  const res = await aiClient.evals.scorers.$get();
  if (!res.ok) throw new Error('Failed to fetch scorers');
  return res.json();
}

async function fetchLiveScores(): Promise<LiveScore[]> {
  const res = await aiClient.evals.live.$get();
  if (!res.ok) throw new Error('Failed to fetch live scores');
  return res.json();
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Extract all unique scorer keys from run results. */
function collectScorerKeys(runs: EvalRun[]): string[] {
  const keys = new Set<string>();
  for (const run of runs) {
    if (!run.results || typeof run.results !== 'object') continue;
    const items = Array.isArray(run.results) ? run.results : [];
    for (const item of items) {
      if (typeof item === 'object' && item !== null && 'scores' in item) {
        const scores = (item as { scores: Record<string, unknown> }).scores;
        for (const key of Object.keys(scores)) keys.add(key);
      }
    }
  }
  return Array.from(keys).sort();
}

/** Compute average scores for a run across all items. */
function computeAverages(results: unknown): Record<string, number | undefined> {
  if (!results || typeof results !== 'object') return {};
  const items = Array.isArray(results) ? results : [];
  if (items.length === 0) return {};

  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};

  for (const item of items) {
    const scores =
      typeof item === 'object' && item !== null && 'scores' in item
        ? (item as { scores: Record<string, number> }).scores
        : {};
    for (const [key, val] of Object.entries(scores)) {
      if (typeof val === 'number') {
        sums[key] = (sums[key] ?? 0) + val;
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
  }

  const averages: Record<string, number | undefined> = {};
  for (const key of Object.keys(sums)) {
    averages[key] = counts[key] > 0 ? sums[key] / counts[key] : undefined;
  }
  return averages;
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

/** Pretty-print a scorer ID for column headers. */
function formatScorerLabel(id: string): string {
  return id
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Page ─────────────────────────────────────────────────────────────

function EvalsPage() {
  const {
    data: runs = [],
    isLoading: runsLoading,
    isError: runsError,
  } = useQuery({
    queryKey: ['eval-runs'],
    queryFn: fetchEvalRuns,
  });

  const { data: scorersList = [] } = useQuery({
    queryKey: ['eval-scorers'],
    queryFn: fetchScorers,
  });

  const { data: liveScores = [] } = useQuery({
    queryKey: ['eval-live-scores'],
    queryFn: fetchLiveScores,
    refetchInterval: 10_000,
  });

  const scorerKeys = collectScorerKeys(runs);

  return (
    <div className="p-6 space-y-6">
      {/* ── Registered Scorers ──────────────────────────────── */}
      {scorersList.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {scorersList.map((scorer) => (
            <Card key={scorer.id} className="gap-0">
              <CardHeader className="pb-1.5">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm font-medium">
                    {scorer.name}
                  </CardTitle>
                  {scorer.hasJudge && (
                    <Badge variant="outline" className="text-xs gap-1">
                      <ZapIcon className="h-3 w-3" />
                      LLM Judge
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {scorer.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Eval Runs ──────────────────────────────────────── */}
      {runsLoading && (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      )}

      {runsError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">
            Failed to load eval runs. The evals API may not be available.
          </p>
        </div>
      )}

      {/* ── Live Scores ────────────────────────────────────── */}
      {liveScores.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">
            Live Scores
            <span className="ml-2 text-muted-foreground font-normal">
              {liveScores.length} results
            </span>
          </h3>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Scorer
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Score
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Reason
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Agent
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody>
                {liveScores.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {formatScorerLabel(s.scorerId)}
                    </td>
                    <td className="px-3 py-2.5">
                      <ScoreCell value={s.score} />
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground text-xs max-w-xs truncate">
                      {s.reason ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {s.agentId ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {formatDateTime(s.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Batch Eval Runs ────────────────────────────────── */}
      {runs.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">
            Batch Runs
            <span className="ml-2 text-muted-foreground font-normal">
              {runs.length} runs
            </span>
          </h3>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Agent
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Items
                  </th>
                  {scorerKeys.map((key) => (
                    <th
                      key={key}
                      className="px-3 py-2 text-left text-xs font-medium text-muted-foreground"
                    >
                      {formatScorerLabel(key)}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const averages = computeAverages(run.results);
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
                            className="text-xs capitalize"
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
                      {scorerKeys.map((key) => (
                        <td key={key} className="px-3 py-2.5">
                          <ScoreCell value={averages[key]} />
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                        {formatDateTime(run.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Empty state ────────────────────────────────────── */}
      {!runsLoading &&
        !runsError &&
        runs.length === 0 &&
        liveScores.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center">
              <FlaskConicalIcon className="mx-auto h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium mb-1">No eval results yet</p>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
                Scorers are active on the booking agent. Chat with the agent to
                generate live scores, or trigger a batch run via the API.
              </p>
              <Badge variant="outline" className="text-xs">
                POST /api/ai/evals/run
              </Badge>
            </CardContent>
          </Card>
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

export const Route = createFileRoute('/_app/_ai/ai/evals')({
  component: EvalsPage,
});
