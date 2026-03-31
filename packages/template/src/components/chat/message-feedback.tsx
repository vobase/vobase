import { ThumbsDownIcon, ThumbsUpIcon } from 'lucide-react';
import { useCallback } from 'react';

import { TooltipIconButton } from '@/components/assistant-ui/tooltip-icon-button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface Reactor {
  userId: string;
  userName: string | null;
  userImage: string | null;
}

export interface MessageReactions {
  positive: Reactor[];
  negative: Reactor[];
}

interface MessageFeedbackProps {
  messageId: string;
  reactions?: MessageReactions;
  currentUserId?: string;
  onReact?: (messageId: string, rating: 'positive' | 'negative') => void;
}

function getInitials(name: string | null): string {
  if (!name) return '?';
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/** Tiny avatar for reactor display */
function MiniAvatar({ reactor }: { reactor: Reactor }) {
  if (reactor.userImage) {
    return (
      <img
        src={reactor.userImage}
        alt={reactor.userName ?? ''}
        className="size-[18px] rounded-full object-cover ring-1 ring-background"
      />
    );
  }
  return (
    <span className="inline-flex size-[18px] items-center justify-center rounded-full bg-muted text-[8px] leading-none text-muted-foreground ring-1 ring-background">
      {getInitials(reactor.userName)}
    </span>
  );
}

/** Avatar cluster showing who reacted */
function ReactorAvatars({
  reactors,
  variant,
}: {
  reactors: Reactor[];
  variant: 'positive' | 'negative';
}) {
  if (reactors.length === 0) return null;

  const names = reactors.map((r) => r.userName ?? 'Anonymous');
  const tooltipText =
    names.length <= 3
      ? names.join(', ')
      : `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex h-6 items-center gap-0.5 rounded-full border px-1 cursor-default',
            variant === 'positive' &&
              'border-green-200/60 bg-green-50/50 dark:border-green-800/60 dark:bg-green-950/30',
            variant === 'negative' &&
              'border-red-200/60 bg-red-50/50 dark:border-red-800/60 dark:bg-red-950/30',
          )}
        >
          <span className="flex -space-x-1">
            {reactors.slice(0, 3).map((r) => (
              <MiniAvatar key={r.userId} reactor={r} />
            ))}
          </span>
          {reactors.length > 3 && (
            <span className="text-[10px] text-muted-foreground">
              +{reactors.length - 3}
            </span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Message feedback with icon buttons + reactor avatars.
 * Icon buttons use TooltipIconButton — identical to Copy/More.
 * When users react, avatar clusters appear inline.
 */
export function MessageFeedback({
  messageId,
  reactions,
  currentUserId,
  onReact,
}: MessageFeedbackProps) {
  const positive = reactions?.positive ?? [];
  const negative = reactions?.negative ?? [];
  const hasPositive = currentUserId
    ? positive.some((r) => r.userId === currentUserId)
    : false;
  const hasNegative = currentUserId
    ? negative.some((r) => r.userId === currentUserId)
    : false;

  const handleReact = useCallback(
    (rating: 'positive' | 'negative') => {
      onReact?.(messageId, rating);
    },
    [messageId, onReact],
  );

  return (
    <div className="flex h-6 items-center gap-1 text-muted-foreground">
      <div className="flex items-center gap-0.5">
        <TooltipIconButton
          tooltip="Helpful"
          className={cn(hasPositive && 'text-green-600 dark:text-green-400')}
          onClick={() => handleReact('positive')}
        >
          <ThumbsUpIcon />
        </TooltipIconButton>
        <ReactorAvatars reactors={positive} variant="positive" />
      </div>
      <div className="flex items-center gap-0.5">
        <TooltipIconButton
          tooltip="Not helpful"
          className={cn(hasNegative && 'text-red-600 dark:text-red-400')}
          onClick={() => handleReact('negative')}
        >
          <ThumbsDownIcon />
        </TooltipIconButton>
        <ReactorAvatars reactors={negative} variant="negative" />
      </div>
    </div>
  );
}
