import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, XIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RelativeTimeCard } from '@/components/ui/relative-time-card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Status, StatusIndicator, StatusLabel } from '@/components/ui/status';
import { Textarea } from '@/components/ui/textarea';
import { automationClient } from '@/lib/api-client';
import { fetchTasks, type Task } from './-shared';

type StatusVariant = 'default' | 'success' | 'error' | 'warning' | 'info';

const STATUS_VARIANT_MAP: Record<string, StatusVariant> = {
  executing: 'warning',
  completed: 'success',
  timeout: 'warning',
  failed: 'error',
  queued: 'info',
  pending: 'default',
  cancelled: 'default',
};

function statusVariant(status: string): StatusVariant {
  return STATUS_VARIANT_MAP[status] ?? 'default';
}

function TaskRow({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await automationClient.tasks[':id'].cancel.$post({
        param: { id: task.id },
      });
      if (!res.ok) throw new Error('Failed to cancel task');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-tasks'] });
    },
  });

  const canCancel = task.status === 'pending' || task.status === 'executing';

  return (
    <>
      <tr
        className="border-b transition-colors hover:bg-muted/30 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="px-4 py-3 whitespace-nowrap">
          <Status variant={statusVariant(task.status)}>
            <StatusIndicator />
            <StatusLabel className="capitalize">{task.status}</StatusLabel>
          </Status>
        </td>
        <td className="px-4 py-3 text-sm font-medium truncate max-w-[140px]">
          {task.adapterId}
        </td>
        <td className="px-4 py-3 text-sm truncate max-w-[180px]">
          {task.action}
        </td>
        <td className="px-4 py-3 text-sm text-muted-foreground capitalize">
          {task.requestedBy}
        </td>
        <td className="px-4 py-3 text-sm text-muted-foreground truncate max-w-[120px]">
          {task.assignedTo ?? <span className="italic">—</span>}
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          <RelativeTimeCard date={task.createdAt} />
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1 justify-end">
            {canCancel && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                disabled={cancelMutation.isPending}
                onClick={(e) => {
                  e.stopPropagation();
                  cancelMutation.mutate();
                }}
              >
                <XIcon className="size-3" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
            >
              {expanded ? (
                <ChevronUpIcon className="size-3" />
              ) : (
                <ChevronDownIcon className="size-3" />
              )}
            </Button>
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b bg-muted/20">
          <td colSpan={7} className="px-4 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                  Input
                </p>
                <pre className="rounded-md bg-muted px-3 py-2 text-xs font-mono overflow-auto max-h-40">
                  {JSON.stringify(task.input, null, 2)}
                </pre>
              </div>

              {task.output && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Output
                  </p>
                  <pre className="rounded-md bg-muted px-3 py-2 text-xs font-mono overflow-auto max-h-40">
                    {JSON.stringify(task.output, null, 2)}
                  </pre>
                </div>
              )}

              {task.errorMessage && (
                <div className="md:col-span-2">
                  <p className="text-xs font-medium text-destructive uppercase tracking-wider mb-1.5">
                    Error
                  </p>
                  <p className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
                    {task.errorMessage}
                  </p>
                </div>
              )}

              {task.domSnapshot && (
                <div className="md:col-span-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    DOM Snapshot
                  </p>
                  <ScrollArea className="h-40">
                    <pre className="rounded-md bg-muted px-3 py-2 text-xs font-mono whitespace-pre-wrap">
                      {task.domSnapshot}
                    </pre>
                  </ScrollArea>
                </div>
              )}

              <div className="md:col-span-2 flex items-center gap-4 text-xs text-muted-foreground border-t pt-3 mt-1">
                <span>
                  ID: <span className="font-mono">{task.id}</span>
                </span>
                <span className="flex items-center gap-1">
                  Updated: <RelativeTimeCard date={task.updatedAt} />
                </span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

const ADAPTERS: Record<string, { name: string; actions: string[] }> = {
  whatsapp: {
    name: 'WhatsApp Web',
    actions: ['createGroup', 'getGroupMembers'],
  },
};

const ACTION_INPUT_HINTS: Record<string, string> = {
  createGroup: '{\n  "groupName": "My Group",\n  "participants": ["+65..."]\n}',
  getGroupMembers: '{}',
};

function NewTaskDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [adapterId, setAdapterId] = useState('whatsapp');
  const [action, setAction] = useState('');
  const [inputJson, setInputJson] = useState('{}');
  const [jsonError, setJsonError] = useState('');

  const createMutation = useMutation({
    mutationFn: async () => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(inputJson);
      } catch {
        throw new Error('Invalid JSON input');
      }

      const res = await automationClient.tasks.$post({
        json: {
          adapterId,
          action,
          input: parsed,
        },
      });
      if (!res.ok) throw new Error('Failed to create task');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-tasks'] });
      setOpen(false);
      setAction('');
      setInputJson('{}');
      setJsonError('');
    },
  });

  const availableActions = ADAPTERS[adapterId]?.actions ?? [];

  function handleActionChange(value: string) {
    setAction(value);
    setInputJson(ACTION_INPUT_HINTS[value] ?? '{}');
    setJsonError('');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      JSON.parse(inputJson);
      setJsonError('');
    } catch {
      setJsonError('Invalid JSON');
      return;
    }
    createMutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <PlusIcon className="size-3.5" />
          New Task
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="adapter">Adapter</Label>
            <Select value={adapterId} onValueChange={setAdapterId}>
              <SelectTrigger id="adapter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ADAPTERS).map(([id, { name }]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="action">Action</Label>
            <Select value={action} onValueChange={handleActionChange}>
              <SelectTrigger id="action">
                <SelectValue placeholder="Select action..." />
              </SelectTrigger>
              <SelectContent>
                {availableActions.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="input">Input (JSON)</Label>
            <Textarea
              id="input"
              value={inputJson}
              onChange={(e) => {
                setInputJson(e.target.value);
                setJsonError('');
              }}
              className="font-mono text-xs min-h-[120px]"
              placeholder="{}"
            />
            {jsonError && (
              <p className="text-xs text-destructive">{jsonError}</p>
            )}
          </div>

          {createMutation.isError && (
            <p className="text-xs text-destructive">
              {createMutation.error.message}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!action || createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TasksPage() {
  const {
    data: tasks,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['automation-tasks'],
    queryFn: fetchTasks,
    refetchInterval: 5_000,
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Tasks</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Browser automation task queue
          </p>
        </div>
        <div className="flex items-center gap-3">
          {tasks && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {tasks.length} task{tasks.length !== 1 ? 's' : ''}
            </span>
          )}
          <NewTaskDialog />
        </div>
      </div>

      <Card className="p-0 overflow-hidden">
        {isLoading && (
          <div className="divide-y">
            {Array.from({ length: 6 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-16 ml-auto" />
              </div>
            ))}
          </div>
        )}

        {isError && (
          <p className="text-sm text-destructive text-center py-12">
            Failed to load tasks. Please try again.
          </p>
        )}

        {!isLoading && !isError && tasks?.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-12">
            No tasks yet.
          </p>
        )}

        {tasks && tasks.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Adapter
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Action
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Requested By
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Assigned To
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export const Route = createFileRoute('/_app/automation/tasks')({
  component: TasksPage,
});
