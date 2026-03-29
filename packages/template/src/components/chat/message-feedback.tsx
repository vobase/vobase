import { ThumbsDownIcon, ThumbsUpIcon } from 'lucide-react';
import { useCallback } from 'react';

import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarImage,
} from '@/components/ui/avatar';
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

function ReactionBubble({
  icon,
  reactors,
  isActive,
  onClick,
  variant,
  showWhenEmpty,
}: {
  icon: React.ReactNode;
  reactors: Reactor[];
  isActive: boolean;
  onClick: () => void;
  variant: 'positive' | 'negative';
  showWhenEmpty?: boolean;
}) {
  if (reactors.length === 0 && !isActive && !showWhenEmpty) return null;

  const names = reactors.map((r) => r.userName ?? 'Anonymous');
  const tooltipText =
    names.length === 0
      ? undefined
      : names.length <= 3
        ? names.join(', ')
        : `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;

  const bubble = (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors',
        'hover:bg-muted/80',
        isActive &&
          variant === 'positive' &&
          'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950',
        isActive &&
          variant === 'negative' &&
          'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950',
        !isActive && 'border-transparent bg-muted/40',
      )}
    >
      {icon}
      {reactors.length > 0 && (
        <>
          <AvatarGroup className="ml-0.5">
            {reactors.slice(0, 3).map((r) => (
              <Avatar
                key={r.userId}
                size="sm"
                className="size-4 ring-1 ring-background"
              >
                {r.userImage && <AvatarImage src={r.userImage} />}
                <AvatarFallback className="text-[8px]">
                  {getInitials(r.userName)}
                </AvatarFallback>
              </Avatar>
            ))}
          </AvatarGroup>
          {reactors.length > 3 && (
            <span className="text-[10px] text-muted-foreground">
              +{reactors.length - 3}
            </span>
          )}
        </>
      )}
    </button>
  );

  if (!tooltipText) return bubble;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{bubble}</TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Telegram/WhatsApp-style message reactions.
 * Shows thumb up/down bubbles with reactor avatars.
 * Multiple users can react; clicking toggles own reaction.
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

  const showPositive = positive.length > 0 || hasPositive;
  const showNegative = negative.length > 0 || hasNegative;
  const showEmpty = !showPositive && !showNegative;

  return (
    <div className="flex items-center gap-1 ml-[18px]">
      <ReactionBubble
        icon={
          <ThumbsUpIcon
            className={cn(
              'size-3',
              hasPositive
                ? 'text-green-600 dark:text-green-400'
                : 'text-muted-foreground',
            )}
          />
        }
        reactors={positive}
        isActive={hasPositive}
        onClick={() => handleReact('positive')}
        variant="positive"
        showWhenEmpty={showEmpty}
      />
      <ReactionBubble
        icon={
          <ThumbsDownIcon
            className={cn(
              'size-3',
              hasNegative
                ? 'text-red-600 dark:text-red-400'
                : 'text-muted-foreground',
            )}
          />
        }
        reactors={negative}
        isActive={hasNegative}
        onClick={() => handleReact('negative')}
        variant="negative"
        showWhenEmpty={showEmpty}
      />
    </div>
  );
}
