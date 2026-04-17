import type { ParameterSchemaT } from '@modules/messaging/lib/parameter-schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowLeftIcon,
  PauseIcon,
  PlayIcon,
  TrashIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react';
import { parseAsString, useQueryState } from 'nuqs';
import { useState } from 'react';
import { toast } from 'sonner';

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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RelativeTimeCard } from '@/components/ui/relative-time-card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Status, StatusIndicator, StatusLabel } from '@/components/ui/status';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { messagingClient } from '@/lib/api-client';
import { cronToHuman, ruleStatusVariant, ruleTypeLabel } from './_lib/helpers';
import { ParameterEditor } from './_lib/parameter-editor';
import { SimulateDialog } from './_lib/simulate-dialog';

// ─── Types ───────────────────────────────────────────────────────────

interface RuleStep {
  id: string;
  sequence: number;
  offsetDays: number | null;
  sendAtTime: string | null;
  delayHours: number | null;
  templateId: string;
  templateName: string;
  templateLanguage: string;
  variableMapping: Record<string, string>;
  isFinal: boolean;
}

interface Execution {
  id: string;
  stepSequence: number;
  firedAt: string;
  status: string;
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
}

interface AudiencePreview {
  count: number;
  samples: Array<{ id: string; name: string; phone: string; role: string }>;
}

interface AutomationRule {
  id: string;
  name: string;
  description: string | null;
  type: 'recurring' | 'date-relative';
  isActive: boolean;
  schedule: string | null;
  dateAttribute: string | null;
  timezone: string;
  lastFiredAt: string | null;
  nextFireAt: string | null;
  createdAt: string;
  parameters: Record<string, unknown>;
  parameterSchema: ParameterSchemaT;
  steps: RuleStep[];
  recentExecutions: Execution[];
}

// ─── Data fetching ───────────────────────────────────────────────────

async function fetchRule(id: string): Promise<AutomationRule> {
  const res = await messagingClient.automation.rules[':id'].$get({
    param: { id },
  });
  if (!res.ok) throw new Error('Failed to fetch rule');
  return res.json() as Promise<AutomationRule>;
}

interface ExecutionFilters {
  status?: string;
  date_from?: string;
  date_to?: string;
}

async function fetchExecutions(
  id: string,
  filters: ExecutionFilters = {},
): Promise<{ data: Execution[]; total: number }> {
  const params = new URLSearchParams({ limit: '50', offset: '0' });
  if (filters.status) params.set('status', filters.status);
  if (filters.date_from) params.set('date_from', filters.date_from);
  if (filters.date_to) params.set('date_to', filters.date_to);

  const res = await fetch(
    `/api/messaging/automation/rules/${id}/executions?${params.toString()}`,
  );
  if (!res.ok) throw new Error('Failed to fetch executions');
  return res.json() as Promise<{ data: Execution[]; total: number }>;
}

async function fetchAudiencePreview(id: string): Promise<AudiencePreview> {
  const res = await messagingClient.automation.rules[':id'][
    'audience-preview'
  ].$post({
    param: { id },
  });
  if (!res.ok) throw new Error('Failed to fetch audience preview');
  return res.json() as Promise<AudiencePreview>;
}

// ─── Execution status helpers ─────────────────────────────────────────

function executionStatusVariant(
  status: string,
): 'default' | 'success' | 'error' | 'warning' | 'info' {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'running') return 'info';
  return 'default';
}

// ─── Step card ────────────────────────────────────────────────────────

function StepRow({ step }: { step: RuleStep }) {
  const delay =
    step.offsetDays != null
      ? `Day +${step.offsetDays}`
      : step.delayHours != null
        ? `+${step.delayHours}h`
        : null;

  return (
    <div className="flex items-start gap-3 rounded-lg border bg-card p-3">
      <span className="text-muted-foreground mt-0.5 shrink-0 font-mono text-xs">
        #{step.sequence}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate font-mono text-sm">{step.templateName}</span>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {delay && <span>{delay}</span>}
          {step.sendAtTime && <span>@ {step.sendAtTime}</span>}
          <span>{step.templateLanguage}</span>
          {step.isFinal && (
            <Badge variant="outline" className="h-4 px-1 text-xs">
              final
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────

function RuleDetailPage() {
  const { ruleId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [simulateOpen, setSimulateOpen] = useState(false);

  const [execStatus, setExecStatus] = useQueryState(
    'exec_status',
    parseAsString.withDefault(''),
  );
  const [execFrom, setExecFrom] = useQueryState(
    'exec_from',
    parseAsString.withDefault(''),
  );
  const [execTo, setExecTo] = useQueryState(
    'exec_to',
    parseAsString.withDefault(''),
  );

  const { data: rule, isLoading } = useQuery({
    queryKey: ['automation-rule', ruleId],
    queryFn: () => fetchRule(ruleId),
  });

  const filters: ExecutionFilters = {
    ...(execStatus && { status: execStatus }),
    ...(execFrom && { date_from: new Date(execFrom).toISOString() }),
    ...(execTo && { date_to: new Date(execTo).toISOString() }),
  };

  const { data: executions } = useQuery({
    queryKey: [
      'automation-rule-executions',
      ruleId,
      execStatus,
      execFrom,
      execTo,
    ],
    queryFn: () => fetchExecutions(ruleId, filters),
    enabled: !!rule,
  });

  const { data: audience, isLoading: audienceLoading } = useQuery({
    queryKey: ['automation-rule-audience', ruleId],
    queryFn: () => fetchAudiencePreview(ruleId),
    enabled: !!rule,
  });

  const pauseMutation = useMutation({
    mutationFn: async () => {
      const res = await messagingClient.automation.rules[':id'].pause.$post({
        param: { id: ruleId },
      });
      if (!res.ok) throw new Error('Failed to pause');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-rule', ruleId] });
      queryClient.invalidateQueries({ queryKey: ['automation-rules'] });
    },
    onError: () => toast.error('Failed to pause rule'),
  });

  const resumeMutation = useMutation({
    mutationFn: async () => {
      const res = await messagingClient.automation.rules[':id'].resume.$post({
        param: { id: ruleId },
      });
      if (!res.ok) throw new Error('Failed to resume');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-rule', ruleId] });
      queryClient.invalidateQueries({ queryKey: ['automation-rules'] });
    },
    onError: () => toast.error('Failed to resume rule'),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await messagingClient.automation.rules[':id'].$delete({
        param: { id: ruleId },
      });
      if (!res.ok) throw new Error('Failed to delete');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-rules'] });
      navigate({ to: '/campaigns/rules' });
    },
    onError: () => toast.error('Failed to delete rule'),
  });

  const paramSaveMutation = useMutation({
    mutationFn: async (parameters: Record<string, unknown>) => {
      const res = await messagingClient.automation.rules[':id'].$patch(
        { param: { id: ruleId } },
        {
          init: {
            body: JSON.stringify({ parameters }),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      );
      if (!res.ok) throw new Error('Failed to save parameters');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-rule', ruleId] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="col-span-2 space-y-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!rule) return null;

  const scheduleLabel =
    rule.type === 'recurring'
      ? cronToHuman(rule.schedule)
      : rule.dateAttribute
        ? `On ${rule.dateAttribute}`
        : 'No date attribute';

  const hasParams = Object.keys(rule.parameterSchema).length > 0;

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <Link
          to="/campaigns/rules"
          className="text-muted-foreground flex w-fit items-center gap-1.5 text-sm hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          All rules
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold tracking-tight">{rule.name}</h2>
              <Badge variant="outline" className="text-xs">
                {ruleTypeLabel(rule.type)}
              </Badge>
            </div>
            {rule.description && (
              <p className="text-muted-foreground text-sm">
                {rule.description}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Status variant={ruleStatusVariant(rule.isActive)}>
              <StatusIndicator />
              <StatusLabel>{rule.isActive ? 'Active' : 'Paused'}</StatusLabel>
            </Status>

            {rule.isActive ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => pauseMutation.mutate()}
                disabled={pauseMutation.isPending}
              >
                <PauseIcon className="size-3.5" />
                Pause
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => resumeMutation.mutate()}
                disabled={resumeMutation.isPending}
              >
                <PlayIcon className="size-3.5" />
                Resume
              </Button>
            )}

            <SimulateDialog
              ruleId={ruleId}
              ruleName={rule.name}
              open={simulateOpen}
              onOpenChange={setSimulateOpen}
            />

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-destructive hover:text-destructive"
                >
                  <TrashIcon className="size-3.5" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete rule?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes the rule, all steps, and execution
                    history. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteMutation.mutate()}
                    disabled={deleteMutation.isPending}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>

      <Separator />

      {/* Body */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="col-span-2 flex flex-col gap-6">
          {/* Parameters */}
          {hasParams && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Parameters</CardTitle>
              </CardHeader>
              <CardContent>
                <ParameterEditor
                  schema={rule.parameterSchema}
                  values={rule.parameters}
                  onSave={async (params) => {
                    await paramSaveMutation.mutateAsync(params);
                  }}
                />
              </CardContent>
            </Card>
          )}

          {/* Steps */}
          {rule.steps.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Steps ({rule.steps.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {rule.steps.map((step) => (
                  <StepRow key={step.id} step={step} />
                ))}
              </CardContent>
            </Card>
          )}

          {/* Execution history */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-base">Execution history</CardTitle>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs text-muted-foreground">
                      Status
                    </Label>
                    <Select
                      value={execStatus || 'all'}
                      onValueChange={(v) =>
                        void setExecStatus(v === 'all' ? '' : v)
                      }
                    >
                      <SelectTrigger className="h-7 w-28 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="running">Running</SelectItem>
                        <SelectItem value="failed">Failed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs text-muted-foreground">
                      From
                    </Label>
                    <Input
                      type="date"
                      className="h-7 w-32 text-xs"
                      value={execFrom}
                      onChange={(e) => void setExecFrom(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs text-muted-foreground">To</Label>
                    <Input
                      type="date"
                      className="h-7 w-32 text-xs"
                      value={execTo}
                      onChange={(e) => void setExecTo(e.target.value)}
                    />
                  </div>
                  {(execStatus || execFrom || execTo) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        void setExecStatus('');
                        void setExecFrom('');
                        void setExecTo('');
                      }}
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {!executions || executions.data.length === 0 ? (
                <p className="text-muted-foreground px-6 pb-4 text-sm">
                  No executions yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fired</TableHead>
                      <TableHead>Step</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Recipients</TableHead>
                      <TableHead className="text-right">
                        Sent / Del / Fail
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {executions.data.map((ex) => (
                      <TableRow key={ex.id}>
                        <TableCell>
                          <RelativeTimeCard date={ex.firedAt} />
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          #{ex.stepSequence}
                        </TableCell>
                        <TableCell>
                          <Status variant={executionStatusVariant(ex.status)}>
                            <StatusIndicator />
                            <StatusLabel>{ex.status}</StatusLabel>
                          </Status>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {ex.totalRecipients}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {ex.sentCount} / {ex.deliveredCount} /{' '}
                          {ex.failedCount}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right sidebar */}
        <div className="flex flex-col gap-4">
          {/* Schedule info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Schedule</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="text-muted-foreground">Type</span>
                <span className="font-medium">{ruleTypeLabel(rule.type)}</span>
              </div>
              <div className="flex items-start justify-between gap-2">
                <span className="text-muted-foreground shrink-0">Trigger</span>
                <span className="text-right font-mono text-xs">
                  {scheduleLabel}
                </span>
              </div>
              <div className="flex items-start justify-between gap-2">
                <span className="text-muted-foreground shrink-0">Timezone</span>
                <span className="font-mono text-xs">{rule.timezone}</span>
              </div>
              {rule.lastFiredAt && (
                <div className="flex items-start justify-between gap-2">
                  <span className="text-muted-foreground shrink-0">
                    Last fired
                  </span>
                  <RelativeTimeCard date={rule.lastFiredAt} />
                </div>
              )}
              {rule.nextFireAt && rule.isActive && (
                <div className="flex items-start justify-between gap-2">
                  <span className="text-muted-foreground shrink-0">
                    Next fire
                  </span>
                  <RelativeTimeCard date={rule.nextFireAt} />
                </div>
              )}
              <div className="flex items-start justify-between gap-2">
                <span className="text-muted-foreground shrink-0">Created</span>
                <RelativeTimeCard date={rule.createdAt} />
              </div>
            </CardContent>
          </Card>

          {/* Audience preview */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <UsersIcon className="size-4" />
                Audience
              </CardTitle>
            </CardHeader>
            <CardContent>
              {audienceLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : audience ? (
                <div className="flex flex-col gap-3">
                  <p className="text-2xl font-bold tabular-nums">
                    {audience.count.toLocaleString()}
                  </p>
                  {audience.samples.length > 0 && (
                    <div className="flex flex-col gap-1">
                      {audience.samples.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="truncate text-muted-foreground">
                            {s.name || s.phone}
                          </span>
                          <Badge
                            variant="outline"
                            className="h-4 shrink-0 px-1 text-xs"
                          >
                            {s.role}
                          </Badge>
                        </div>
                      ))}
                      {audience.count > audience.samples.length && (
                        <p className="text-xs text-muted-foreground">
                          +
                          {(
                            audience.count - audience.samples.length
                          ).toLocaleString()}{' '}
                          more
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No audience data.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/campaigns/rules/$ruleId')({
  component: RuleDetailPage,
});
