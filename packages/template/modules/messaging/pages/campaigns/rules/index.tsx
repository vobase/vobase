import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
  ZapIcon,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { RelativeTimeCard } from '@/components/ui/relative-time-card';
import { Skeleton } from '@/components/ui/skeleton';
import { Status, StatusIndicator, StatusLabel } from '@/components/ui/status';
import { messagingClient } from '@/lib/api-client';
import { cronToHuman, ruleStatusVariant, ruleTypeLabel } from './_lib/helpers';
import { PromptDialog } from './_lib/prompt-dialog';

// ─── Types ───────────────────────────────────────────────────────────

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
}

// ─── Data fetching ───────────────────────────────────────────────────

async function fetchRules(): Promise<{
  data: AutomationRule[];
  total: number;
}> {
  const res = await messagingClient.automation.rules.$get({
    query: { limit: '50', offset: '0' },
  });
  if (!res.ok) throw new Error('Failed to fetch automation rules');
  return res.json() as Promise<{ data: AutomationRule[]; total: number }>;
}

// ─── Rule card ────────────────────────────────────────────────────────

function RuleCard({ rule }: { rule: AutomationRule }) {
  const queryClient = useQueryClient();

  const pauseMutation = useMutation({
    mutationFn: async () => {
      const res = await messagingClient.automation.rules[':id'].pause.$post({
        param: { id: rule.id },
      });
      if (!res.ok) throw new Error('Failed to pause rule');
      return res.json();
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['automation-rules'] });
      const prev = queryClient.getQueryData<{
        data: AutomationRule[];
        total: number;
      }>(['automation-rules']);
      if (prev) {
        queryClient.setQueryData(['automation-rules'], {
          ...prev,
          data: prev.data.map((r) =>
            r.id === rule.id ? { ...r, isActive: false } : r,
          ),
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['automation-rules'], ctx.prev);
      toast.error('Failed to pause rule');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-rules'] });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: async () => {
      const res = await messagingClient.automation.rules[':id'].resume.$post({
        param: { id: rule.id },
      });
      if (!res.ok) throw new Error('Failed to resume rule');
      return res.json();
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['automation-rules'] });
      const prev = queryClient.getQueryData<{
        data: AutomationRule[];
        total: number;
      }>(['automation-rules']);
      if (prev) {
        queryClient.setQueryData(['automation-rules'], {
          ...prev,
          data: prev.data.map((r) =>
            r.id === rule.id ? { ...r, isActive: true } : r,
          ),
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['automation-rules'], ctx.prev);
      toast.error('Failed to resume rule');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-rules'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await messagingClient.automation.rules[':id'].$delete({
        param: { id: rule.id },
      });
      if (!res.ok) throw new Error('Failed to delete rule');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-rules'] });
      toast.success('Rule deleted');
    },
    onError: () => {
      toast.error('Failed to delete rule');
    },
  });

  const scheduleLabel =
    rule.type === 'recurring'
      ? cronToHuman(rule.schedule)
      : rule.dateAttribute
        ? `On ${rule.dateAttribute}`
        : 'No date attribute';

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border bg-card p-4 transition-colors hover:bg-accent/5">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <Link
            to="/campaigns/rules/$ruleId"
            params={{ ruleId: rule.id }}
            className="truncate font-medium hover:underline"
          >
            {rule.name}
          </Link>
          <Badge variant="outline" className="shrink-0 text-xs">
            {ruleTypeLabel(rule.type)}
          </Badge>
        </div>

        {rule.description && (
          <p className="text-muted-foreground truncate text-sm">
            {rule.description}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{scheduleLabel}</span>
          {rule.lastFiredAt && (
            <span className="flex items-center gap-1">
              Last fired <RelativeTimeCard date={rule.lastFiredAt} />
            </span>
          )}
          {rule.nextFireAt && rule.isActive && (
            <span className="flex items-center gap-1">
              Next <RelativeTimeCard date={rule.nextFireAt} />
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Status variant={ruleStatusVariant(rule.isActive)}>
          <StatusIndicator />
          <StatusLabel>{rule.isActive ? 'Active' : 'Paused'}</StatusLabel>
        </Status>

        {rule.isActive ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => pauseMutation.mutate()}
            disabled={pauseMutation.isPending}
          >
            <PauseIcon className="size-3" />
            Pause
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => resumeMutation.mutate()}
            disabled={resumeMutation.isPending}
          >
            <PlayIcon className="size-3" />
            Resume
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <MoreHorizontalIcon className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link to="/campaigns/rules/$ruleId" params={{ ruleId: rule.id }}>
                View details
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              <TrashIcon className="size-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────

function RulesPage() {
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['automation-rules'],
    queryFn: fetchRules,
  });

  const rules = data?.data ?? [];

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 sm:gap-6 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Rules</h2>
          <p className="text-muted-foreground">
            Automated messaging sequences triggered by schedule or contact
            attributes.
          </p>
        </div>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => setDialogOpen(true)}
        >
          <PlusIcon className="size-3.5" />
          New rule
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={`skel-${i.toString()}`} className="h-20 w-full" />
          ))}
        </div>
      ) : rules.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <ZapIcon className="size-8" />
            </EmptyMedia>
            <EmptyTitle>No rules yet</EmptyTitle>
            <EmptyDescription>
              Describe a rule in plain language and let AI draft it for you.
            </EmptyDescription>
          </EmptyHeader>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setDialogOpen(true)}
          >
            <PlusIcon className="size-3.5" />
            Create first rule
          </Button>
        </Empty>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <RuleCard key={rule.id} rule={rule} />
          ))}
        </div>
      )}

      <PromptDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

export const Route = createFileRoute('/_app/campaigns/rules/')({
  component: RulesPage,
});
