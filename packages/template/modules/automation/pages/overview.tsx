import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  ActivityIcon,
  CheckCircle2Icon,
  CircleXIcon,
  ClockIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchTasks, STATUS_VARIANT } from './-shared';

function StatCard({
  title,
  value,
  icon: Icon,
  loading,
}: {
  title: string;
  value: number;
  icon: React.ElementType;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-7 w-12" />
        ) : (
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
        )}
      </CardContent>
    </Card>
  );
}

function AutomationDashboard() {
  const {
    data: tasks,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['automation-tasks'],
    queryFn: fetchTasks,
    refetchInterval: 10_000,
  });

  const total = tasks?.length ?? 0;
  const pending = tasks?.filter((t) => t.status === 'pending').length ?? 0;
  const completed = tasks?.filter((t) => t.status === 'completed').length ?? 0;
  const failed =
    tasks?.filter((t) => t.status === 'failed' || t.status === 'timeout')
      .length ?? 0;

  const recent = tasks?.slice(0, 10) ?? [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Browser Automation</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Overview of automation tasks and paired browser sessions
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Tasks"
          value={total}
          icon={ActivityIcon}
          loading={isLoading}
        />
        <StatCard
          title="Pending"
          value={pending}
          icon={ClockIcon}
          loading={isLoading}
        />
        <StatCard
          title="Completed"
          value={completed}
          icon={CheckCircle2Icon}
          loading={isLoading}
        />
        <StatCard
          title="Failed"
          value={failed}
          icon={CircleXIcon}
          loading={isLoading}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm font-medium">Recent Tasks</CardTitle>
          <Link
            to="/automation/tasks"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            View all
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && (
            <div className="divide-y">
              {Array.from({ length: 5 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
                <div key={i} className="flex items-center gap-3 px-6 py-3">
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-32 ml-auto" />
                </div>
              ))}
            </div>
          )}

          {isError && (
            <p className="text-sm text-destructive text-center py-8">
              Failed to load tasks.
            </p>
          )}

          {!isLoading && !isError && recent.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No tasks yet.
            </p>
          )}

          {recent.length > 0 && (
            <div className="divide-y">
              {recent.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center gap-3 px-6 py-3 text-sm"
                >
                  <Badge
                    variant={STATUS_VARIANT[task.status] ?? 'outline'}
                    className="shrink-0 capitalize text-xs"
                  >
                    {task.status}
                  </Badge>
                  <span className="font-medium truncate">{task.action}</span>
                  <span className="text-muted-foreground truncate">
                    {task.adapterId}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {new Date(task.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Link
          to="/automation/tasks"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4"
        >
          Manage tasks
        </Link>
        <span className="text-muted-foreground">·</span>
        <Link
          to="/automation/pairing"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4"
        >
          Pair browser
        </Link>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/automation/overview')({
  component: AutomationDashboard,
});
