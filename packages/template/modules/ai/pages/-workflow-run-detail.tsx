import {
  CheckCircleIcon,
  LoaderIcon,
  PauseCircleIcon,
  XCircleIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { WorkflowRun } from './-workflow-run-history';

const statusDisplay: Record<
  string,
  { icon: typeof CheckCircleIcon; label: string; className: string }
> = {
  running: {
    icon: LoaderIcon,
    label: 'Running',
    className: 'text-blue-600',
  },
  suspended: {
    icon: PauseCircleIcon,
    label: 'Awaiting Action',
    className: 'text-amber-600',
  },
  completed: {
    icon: CheckCircleIcon,
    label: 'Completed',
    className: 'text-green-600',
  },
  failed: {
    icon: XCircleIcon,
    label: 'Failed',
    className: 'text-red-600',
  },
};

function DataSection({
  title,
  data,
}: {
  title: string;
  data: Record<string, unknown> | null;
}) {
  if (!data || Object.keys(data).length === 0) return null;

  return (
    <div>
      <h5 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
        {title}
      </h5>
      <div className="rounded-md border bg-muted/30 p-3 space-y-1">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="flex items-start gap-2 text-sm">
            <span className="text-muted-foreground font-mono text-xs shrink-0 min-w-[100px]">
              {key}
            </span>
            <span className="text-foreground break-all">
              {typeof value === 'object'
                ? JSON.stringify(value)
                : String(value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface WorkflowRunDetailProps {
  run: WorkflowRun;
}

export function WorkflowRunDetail({ run }: WorkflowRunDetailProps) {
  const display = statusDisplay[run.status] ?? statusDisplay.running;
  const Icon = display.icon;

  return (
    <div className="space-y-4">
      {/* Status header */}
      <div className="flex items-center gap-3">
        <Icon className={`size-5 ${display.className}`} />
        <div>
          <p className={`text-sm font-semibold ${display.className}`}>
            {display.label}
          </p>
          <p className="text-xs text-muted-foreground font-mono">{run.id}</p>
        </div>
      </div>

      {/* Timestamps */}
      <div className="flex gap-4 text-xs text-muted-foreground">
        <div>
          <span className="font-medium">Started:</span>{' '}
          {new Date(run.createdAt).toLocaleString()}
        </div>
        {run.updatedAt !== run.createdAt && (
          <div>
            <span className="font-medium">Updated:</span>{' '}
            {new Date(run.updatedAt).toLocaleString()}
          </div>
        )}
      </div>

      {/* Data sections */}
      <DataSection title="Input" data={run.inputData} />

      {run.status === 'suspended' && run.suspendPayload && (
        <div>
          <h5 className="text-xs font-medium text-amber-600 uppercase tracking-wider mb-1.5">
            Waiting For
          </h5>
          <div className="rounded-md border border-amber-200 bg-amber-500/5 p-3 space-y-1">
            {Object.entries(run.suspendPayload).map(([key, value]) => (
              <div key={key} className="flex items-start gap-2 text-sm">
                <span className="text-muted-foreground font-mono text-xs shrink-0 min-w-[100px]">
                  {key}
                </span>
                <span className="text-foreground break-all">
                  {typeof value === 'object'
                    ? JSON.stringify(value)
                    : String(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <DataSection title="Output" data={run.outputData} />

      {run.status === 'failed' && !run.outputData && (
        <Badge variant="destructive" className="text-xs">
          Workflow failed without output
        </Badge>
      )}
    </div>
  );
}
