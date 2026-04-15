import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface MessageScoreGroup {
  scores: Array<{
    scorerId: string;
    score: number;
    reason: string | null;
  }>;
}

/** Pretty-print a scorer ID for display. */
function formatScorerLabel(id: string): string {
  return id
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/^custom\s+\w+\s*/i, '')
    .replace(/\bscorer\b/i, '')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function scoreBgColor(score: number): string {
  const pct = score * 100;
  if (pct >= 80) return 'bg-green-500';
  if (pct >= 60) return 'bg-yellow-500';
  return 'bg-red-500';
}

function scoreTextColor(score: number): string {
  const pct = score * 100;
  if (pct >= 80) return 'text-green-600 dark:text-green-400';
  if (pct >= 60) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

export function MessageQualityIndicator({
  group,
}: {
  group: MessageScoreGroup;
}) {
  if (group.scores.length === 0) return null;

  const avg =
    group.scores.reduce((sum, s) => sum + s.score, 0) / group.scores.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 hover:bg-muted/60 transition-colors"
        >
          {group.scores.map((s) => (
            <span
              key={s.scorerId}
              className={cn('size-2 rounded-full', scoreBgColor(s.score))}
              title={`${formatScorerLabel(s.scorerId)}: ${Math.round(s.score * 100)}%`}
            />
          ))}
          <span
            className={cn(
              'ml-0.5 text-[10px] font-medium',
              scoreTextColor(avg),
            )}
          >
            {Math.round(avg * 100)}%
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 p-3 max-h-96 overflow-y-auto"
      >
        <p className="text-xs font-medium text-foreground mb-2">
          Quality Scores
        </p>
        <div className="space-y-3">
          {group.scores.map((s) => (
            <div key={s.scorerId} className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {formatScorerLabel(s.scorerId)}
                </span>
                <span
                  className={cn('text-xs font-medium', scoreTextColor(s.score))}
                >
                  {Math.round(s.score * 100)}%
                </span>
              </div>
              <div className="h-1 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn('h-full rounded-full', scoreBgColor(s.score))}
                  style={{ width: `${Math.max(s.score * 100, 2)}%` }}
                />
              </div>
              {s.reason && (
                <p className="text-xs text-muted-foreground leading-snug">
                  {s.reason}
                </p>
              )}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
