import { PauseIcon, PlayIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

interface WorkflowStep {
  id: string;
  name: string;
  description: string;
  type: 'action' | 'suspend';
}

interface WorkflowStepTimelineProps {
  steps: WorkflowStep[];
}

export function WorkflowStepTimeline({ steps }: WorkflowStepTimelineProps) {
  return (
    <div className="relative pl-6">
      {/* Vertical connector line */}
      <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border" />

      <div className="space-y-4">
        {steps.map((step, i) => (
          <div key={step.id} className="relative flex items-start gap-3">
            {/* Step icon */}
            <div
              className={`relative z-10 flex h-6 w-6 shrink-0 -ml-6 items-center justify-center rounded-full border-2 ${
                step.type === 'suspend'
                  ? 'border-amber-500 bg-amber-500/10'
                  : 'border-primary bg-primary/10'
              }`}
            >
              {step.type === 'suspend' ? (
                <PauseIcon className="size-3 text-amber-500" />
              ) : (
                <PlayIcon className="size-3 text-primary" />
              )}
            </div>

            {/* Step content */}
            <div className="flex-1 min-w-0 pb-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{step.name}</p>
                {step.type === 'suspend' && (
                  <Badge
                    variant="outline"
                    className="text-xs text-amber-600 border-amber-300"
                  >
                    {i === 1 && steps[0]?.type === 'action'
                      ? 'Requires approval'
                      : 'Delayed execution'}
                  </Badge>
                )}
                {i === 0 && (
                  <span className="text-xs text-muted-foreground">Start</span>
                )}
                {i === steps.length - 1 && (
                  <span className="text-xs text-muted-foreground">End</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {step.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
