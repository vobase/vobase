import { CheckCircle2Icon, ClockIcon, LockIcon, UsersIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'

export interface SimulatedStep {
  sequence: number
  offsetDays: number | null
  sendAtTime: string | null
  delayHours: number | null
  templateName: string
  templateLanguage: string
  isFinal: boolean
  isReplyGated: boolean
}

export interface SimulateResult {
  audienceCount: number
  samples: Array<{ id: string; name: string; phone: string; role: string }>
  timeline: SimulatedStep[]
}

function stepTiming(step: SimulatedStep): string {
  if (step.delayHours != null) {
    return `+${step.delayHours}h after previous`
  }
  if (step.offsetDays != null) {
    return `Day +${step.offsetDays}`
  }
  return 'On trigger'
}

interface ChaserTimelineProps {
  result: SimulateResult
}

export function ChaserTimeline({ result }: ChaserTimelineProps) {
  return (
    <div className="flex flex-col gap-5">
      {/* Audience summary */}
      <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
        <UsersIcon className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex flex-col gap-0.5">
          <span className="text-2xl font-bold tabular-nums">{result.audienceCount.toLocaleString()}</span>
          <span className="text-xs text-muted-foreground">contacts would receive this sequence</span>
        </div>
        {result.samples.length > 0 && (
          <div className="ml-auto flex flex-col items-end gap-0.5">
            {result.samples.slice(0, 3).map((s) => (
              <span key={s.id} className="text-xs text-muted-foreground">
                {s.name || s.phone}
              </span>
            ))}
            {result.audienceCount > result.samples.length && (
              <span className="text-xs text-muted-foreground">
                +{(result.audienceCount - result.samples.length).toLocaleString()} more
              </span>
            )}
          </div>
        )}
      </div>

      {/* Step timeline */}
      <div className="relative flex flex-col gap-0">
        {result.timeline.map((step, i) => {
          const isLast = i === result.timeline.length - 1
          return (
            <div key={step.sequence} className="relative flex gap-3">
              {/* Connector line */}
              {!isLast && <div className="absolute left-[11px] top-6 bottom-0 w-px bg-border" />}

              {/* Node */}
              <div className="relative z-10 mt-1 flex size-6 shrink-0 items-center justify-center rounded-full border bg-background">
                {step.isFinal ? (
                  <CheckCircle2Icon className="size-3.5 text-green-500" />
                ) : step.isReplyGated ? (
                  <LockIcon className="size-3 text-amber-500" />
                ) : (
                  <ClockIcon className="size-3 text-muted-foreground" />
                )}
              </div>

              {/* Content */}
              <div className="flex flex-col gap-1 pb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-medium">{step.templateName}</span>
                  <span className="text-xs text-muted-foreground">{step.templateLanguage}</span>
                  {step.isFinal && (
                    <Badge variant="outline" className="h-4 px-1 text-xs text-green-600">
                      final
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>{stepTiming(step)}</span>
                  {step.sendAtTime && <span>@ {step.sendAtTime}</span>}
                  {step.isReplyGated && (
                    <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                      <LockIcon className="size-3" />
                      only if no reply
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {result.audienceCount === 0 && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          No contacts match the current audience filter — rule would send to 0 recipients.
        </p>
      )}
    </div>
  )
}
