import { ChevronDownIcon } from 'lucide-react';
import { useState } from 'react';

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

function scoreColor(score: number): string {
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
  const [expanded, setExpanded] = useState(false);

  if (group.scores.length === 0) return null;

  const hasReasons = group.scores.some((s) => s.reason);

  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => hasReasons && setExpanded(!expanded)}
        className={cn(
          'inline-flex items-center gap-1.5 text-xs text-muted-foreground',
          hasReasons && 'cursor-pointer hover:text-foreground',
        )}
      >
        {group.scores.map((s, i) => (
          <span key={s.scorerId} className="inline-flex items-center gap-0.5">
            {i > 0 && <span className="text-muted-foreground/40">·</span>}
            <span>{formatScorerLabel(s.scorerId)}</span>
            <span className={cn('font-medium', scoreColor(s.score))}>
              {Math.round(s.score * 100)}%
            </span>
          </span>
        ))}
        {hasReasons && (
          <ChevronDownIcon
            className={cn(
              'h-3 w-3 transition-transform',
              expanded && 'rotate-180',
            )}
          />
        )}
      </button>

      {expanded && (
        <div className="ml-1 space-y-1 border-l-2 border-muted pl-2">
          {group.scores
            .filter((s) => s.reason)
            .map((s) => (
              <p key={s.scorerId} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground/80">
                  {formatScorerLabel(s.scorerId)}:
                </span>{' '}
                {s.reason}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}
