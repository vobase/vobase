import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  FlaskConicalIcon,
  MessageSquareIcon,
  PlusIcon,
  ShieldCheckIcon,
  ThumbsUpIcon,
  Trash2Icon,
  TrendingUpIcon,
  ZapIcon,
} from 'lucide-react';
import { type FormEvent, useCallback, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { aiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────

interface QualityOverview {
  avgScore: number | null;
  totalScores: number;
  conversationsScored: number;
  feedback: { positive: number; negative: number };
  scorerBreakdown: Array<{
    scorerId: string;
    avgScore: number;
    count: number;
  }>;
  worstConversations: Array<{
    conversationId: string;
    avgScore: number;
    scoreCount: number;
    lastScored: string | null;
  }>;
}

interface ScorerMeta {
  id: string;
  name: string;
  description: string;
  hasJudge: boolean;
  source: 'code' | 'custom';
  dbId?: string;
  enabled?: boolean;
  criteria?: string;
  model?: string;
}

// ─── Data ─────────────────────────────────────────────────────────────

async function fetchQualityOverview(days: number): Promise<QualityOverview> {
  const res = await aiClient.evals['quality-overview'].$get({
    query: { days: String(days) },
  });
  if (!res.ok) throw new Error('Failed to fetch quality overview');
  return res.json();
}

async function fetchScorers(): Promise<ScorerMeta[]> {
  const res = await aiClient.evals.scorers.$get();
  if (!res.ok) throw new Error('Failed to fetch scorers');
  return res.json();
}

// ─── Helpers ──────────────────────────────────────────────────────────

function formatScorerLabel(id: string): string {
  return id
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\bscorer\b/i, '')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function scoreColor(score: number): string {
  const pct = score * 100;
  if (pct >= 80) return 'text-green-600 dark:text-green-400';
  if (pct >= 60) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

function scoreBg(score: number): string {
  const pct = score * 100;
  if (pct >= 80) return 'bg-green-500';
  if (pct >= 60) return 'bg-yellow-500';
  return 'bg-red-500';
}

// ─── Page ─────────────────────────────────────────────────────────────

function QualityDashboard() {
  const [days, setDays] = useState(7);

  const {
    data: overview,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['quality-overview', days],
    queryFn: () => fetchQualityOverview(days),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const { data: scorersList = [] } = useQuery({
    queryKey: ['eval-scorers'],
    queryFn: fetchScorers,
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton array
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">
            Failed to load quality data. The evals API may not be available.
          </p>
        </div>
      </div>
    );
  }

  const hasData =
    overview &&
    (overview.totalScores > 0 ||
      overview.feedback.positive > 0 ||
      overview.feedback.negative > 0);

  if (!hasData) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-10 text-center">
            <FlaskConicalIcon className="mx-auto h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium mb-1">No quality data yet</p>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Scorers are active on your AI agents. Chat with an agent to
              generate quality scores automatically.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const avgPct = overview.avgScore ? Math.round(overview.avgScore * 100) : null;
  const totalFeedback = overview.feedback.positive + overview.feedback.negative;
  const feedbackRatio =
    totalFeedback > 0
      ? Math.round((overview.feedback.positive / totalFeedback) * 100)
      : null;

  return (
    <div className="p-6 space-y-6">
      {/* Date range filter */}
      <div className="flex items-center gap-1.5">
        {[
          { label: 'Today', value: 1 },
          { label: '7 days', value: 7 },
          { label: '30 days', value: 30 },
        ].map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setDays(opt.value)}
            className={cn(
              'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
              days === opt.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Overview cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <ShieldCheckIcon className="h-3.5 w-3.5" />
              Quality Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            {avgPct !== null ? (
              <div className="flex items-baseline gap-1.5">
                <span
                  className={cn(
                    'text-2xl font-semibold',
                    scoreColor(overview.avgScore ?? 0),
                  )}
                >
                  {avgPct}%
                </span>
                <span className="text-xs text-muted-foreground">average</span>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">No scores</span>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <TrendingUpIcon className="h-3.5 w-3.5" />
              Conversations Scored
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold">
                {overview.conversationsScored}
              </span>
              <span className="text-xs text-muted-foreground">
                {overview.totalScores} total scores
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <ThumbsUpIcon className="h-3.5 w-3.5" />
              Human Feedback
            </CardTitle>
          </CardHeader>
          <CardContent>
            {totalFeedback > 0 ? (
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-semibold">{feedbackRatio}%</span>
                <span className="text-xs text-muted-foreground">
                  positive ({overview.feedback.positive}/{totalFeedback})
                </span>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">
                No feedback yet
              </span>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <MessageSquareIcon className="h-3.5 w-3.5" />
              Active Scorers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold">
                {scorersList.length}
              </span>
              <span className="text-xs text-muted-foreground">
                {scorersList.filter((s) => s.source === 'code').length} code,{' '}
                {scorersList.filter((s) => s.source === 'custom').length} custom
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Worst conversations */}
      {overview.worstConversations.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">
            Conversations by Quality
            <span className="ml-2 text-muted-foreground font-normal">
              lowest first
            </span>
          </h3>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Conversation
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Quality
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Scores
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Last Scored
                  </th>
                </tr>
              </thead>
              <tbody>
                {overview.worstConversations.map((conv) => {
                  const pct = Math.round(conv.avgScore * 100);
                  return (
                    <tr
                      key={conv.conversationId}
                      className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-3 py-2.5">
                        <Link
                          to="/conversations/$conversationId"
                          params={{
                            conversationId: conv.conversationId,
                          }}
                          className="text-sm text-primary hover:underline font-mono"
                        >
                          {conv.conversationId.slice(0, 8)}…
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn(
                                'h-full rounded-full',
                                scoreBg(conv.avgScore),
                              )}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span
                            className={cn(
                              'text-xs font-medium tabular-nums',
                              scoreColor(conv.avgScore),
                            )}
                          >
                            {pct}%
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground tabular-nums">
                        {conv.scoreCount}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                        {conv.lastScored
                          ? formatDateTime(conv.lastScored)
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Custom Scorers */}
      <CustomScorerSection scorersList={scorersList} />

      {/* Scorer breakdown */}
      {overview.scorerBreakdown.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Scorer Breakdown</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {overview.scorerBreakdown.map((scorer) => {
              const pct = Math.round(scorer.avgScore * 100);
              const meta = scorersList.find((s) => s.id === scorer.scorerId);
              return (
                <div
                  key={scorer.scorerId}
                  className="flex items-center gap-3 rounded-md border p-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {meta?.name ?? formatScorerLabel(scorer.scorerId)}
                    </p>
                    {meta?.description && (
                      <p className="text-xs text-muted-foreground truncate">
                        {meta.description}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {scorer.count} scores
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span
                      className={cn(
                        'text-lg font-semibold tabular-nums',
                        scoreColor(scorer.avgScore),
                      )}
                    >
                      {pct}%
                    </span>
                    <div className="h-1 w-10 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          scoreBg(scorer.avgScore),
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Custom Scorer Management ────────────────────────────────────────

function CustomScorerSection({ scorersList }: { scorersList: ScorerMeta[] }) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const customScorers = scorersList.filter((s) => s.source === 'custom');

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const res = await aiClient.evals.scorers[':id'].$patch(
        { param: { id } },
        {
          init: {
            body: JSON.stringify({ enabled }),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      );
      if (!res.ok) throw new Error('Failed to update scorer');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eval-scorers'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await aiClient.evals.scorers[':id'].$delete({
        param: { id },
      });
      if (!res.ok) throw new Error('Failed to delete scorer');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eval-scorers'] });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (body: {
      name: string;
      description: string;
      criteria: string;
      model: string;
    }) => {
      const res = await aiClient.evals.scorers.$post(
        {},
        {
          init: {
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      );
      if (!res.ok) throw new Error('Failed to create scorer');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eval-scorers'] });
      setDialogOpen(false);
    },
  });

  const handleCreate = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      createMutation.mutate({
        name: fd.get('name') as string,
        description: fd.get('description') as string,
        criteria: fd.get('criteria') as string,
        model: (fd.get('model') as string) || 'gpt-4o-mini',
      });
    },
    [createMutation],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Custom Scorers</h3>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <PlusIcon className="h-3.5 w-3.5" />
              Create Scorer
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Custom Scorer</DialogTitle>
              <DialogDescription>
                Define evaluation criteria in plain English. An LLM judge will
                score agent responses based on your criteria.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="scorer-name">Name</Label>
                <Input
                  id="scorer-name"
                  name="name"
                  placeholder="e.g. Professional Tone"
                  required
                  maxLength={100}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="scorer-description">Description</Label>
                <Input
                  id="scorer-description"
                  name="description"
                  placeholder="What this scorer evaluates"
                  required
                  maxLength={500}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="scorer-criteria">Criteria</Label>
                <Textarea
                  id="scorer-criteria"
                  name="criteria"
                  placeholder="Describe what a good response looks like. Be specific — the LLM judge uses this to score responses from 0.0 to 1.0."
                  required
                  minLength={10}
                  maxLength={5000}
                  rows={4}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="scorer-model">Model</Label>
                <Input
                  id="scorer-model"
                  name="model"
                  placeholder="gpt-4o-mini"
                  defaultValue="gpt-4o-mini"
                />
                <p className="text-xs text-muted-foreground">
                  The LLM model used as the judge
                </p>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating…' : 'Create Scorer'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {customScorers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No custom scorers yet. Create one to evaluate agent responses with
          your own criteria.
        </p>
      ) : (
        <div className="space-y-2">
          {customScorers.map((scorer) => (
            <div
              key={scorer.id}
              className="flex items-center gap-3 rounded-md border p-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{scorer.name}</p>
                  <Badge variant="outline" className="text-xs gap-1">
                    <ZapIcon className="h-3 w-3" />
                    LLM Judge
                  </Badge>
                  {scorer.enabled === false && (
                    <Badge variant="secondary" className="text-xs">
                      Disabled
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {scorer.description}
                </p>
              </div>

              <Switch
                checked={scorer.enabled !== false}
                onCheckedChange={(checked) =>
                  scorer.dbId &&
                  toggleMutation.mutate({
                    id: scorer.dbId,
                    enabled: checked,
                  })
                }
                disabled={toggleMutation.isPending}
              />

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2Icon className="h-3.5 w-3.5" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete scorer?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete "{scorer.name}" and all its
                      scoring criteria. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        scorer.dbId && deleteMutation.mutate(scorer.dbId)
                      }
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/_app/_ai/ai/evals')({
  component: QualityDashboard,
});
