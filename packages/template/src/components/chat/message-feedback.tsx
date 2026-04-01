import { ThumbsDownIcon, ThumbsUpIcon, XIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { TooltipIconButton } from '@/components/assistant-ui/tooltip-icon-button';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  Timeline,
  TimelineConnector,
  TimelineContent,
  TimelineDot,
  TimelineItem,
} from '@/components/ui/timeline';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface Reactor {
  id: string;
  userId: string;
  userName: string | null;
  userImage: string | null;
  reason?: string | null;
}

export interface MessageReactions {
  positive: Reactor[];
  negative: Reactor[];
}

interface MessageFeedbackProps {
  messageId: string;
  reactions?: MessageReactions;
  currentUserId?: string;
  onReact?: (
    messageId: string,
    rating: 'positive' | 'negative',
    reason?: string,
  ) => void;
  onDeleteFeedback?: (messageId: string, feedbackId: string) => void;
}

const NEGATIVE_FEEDBACK_OPTIONS = [
  'Not accurate',
  'Not helpful',
  'Too verbose',
  'Incomplete answer',
  'Wrong tone',
] as const;

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
              <MiniAvatar key={r.id} reactor={r} />
            ))}
          </span>
          {reactors.length > 3 && (
            <span className="text-xs text-muted-foreground">
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

/** Popover for collecting detailed negative feedback. */
function NegativeFeedbackPopover({
  open,
  onOpenChange,
  onSubmit,
  onDeleteEntry,
  allNegativeReactors,
  currentUserId,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => void;
  onDeleteEntry?: (feedbackId: string) => void;
  allNegativeReactors: Reactor[];
  currentUserId?: string;
  children: React.ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setComment('');
    }
  }, [open]);

  const handleToggle = useCallback((option: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(option);
      else next.delete(option);
      return next;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    const parts = [...selected];
    if (comment.trim()) parts.push(comment.trim());
    const reason = parts.join('; ');
    if (!reason) return;
    onSubmit(reason);
    setSelected(new Set());
    setComment('');
  }, [selected, comment, onSubmit]);

  const feedbackEntries = allNegativeReactors.filter((r) => r.reason);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        className="w-80 max-h-96 overflow-y-auto space-y-3 p-4"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {feedbackEntries.length > 0 && (
          <>
            <p className="font-medium text-sm">Feedback</p>
            <Timeline className="gap-3">
              {feedbackEntries.map((reactor) => (
                <TimelineItem key={reactor.id} className="gap-2 pb-3 last:pb-0">
                  <TimelineDot className="size-2.5 border-red-400 dark:border-red-500" />
                  <TimelineConnector className="bg-border" />
                  <TimelineContent className="pt-0 pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-xs text-muted-foreground">
                          {reactor.userName ?? 'Anonymous'}
                          {reactor.userId === currentUserId && (
                            <span className="ml-1 text-muted-foreground/60">
                              (you)
                            </span>
                          )}
                        </p>
                        <p className="text-sm">{reactor.reason}</p>
                      </div>
                      {reactor.userId === currentUserId && onDeleteEntry && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-5 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => onDeleteEntry(reactor.id)}
                        >
                          <XIcon className="size-3" />
                        </Button>
                      )}
                    </div>
                  </TimelineContent>
                </TimelineItem>
              ))}
            </Timeline>
            <Separator />
          </>
        )}

        <p className="font-medium text-sm">What went wrong?</p>
        <div className="space-y-2">
          {NEGATIVE_FEEDBACK_OPTIONS.map((option) => (
            // biome-ignore lint/a11y/noLabelWithoutControl: Checkbox is inside label
            <label
              key={option}
              className="flex items-center gap-2 text-sm cursor-pointer"
            >
              <Checkbox
                checked={selected.has(option)}
                onCheckedChange={(checked) =>
                  handleToggle(option, checked === true)
                }
              />
              {option}
            </label>
          ))}
        </div>
        <Textarea
          placeholder="Additional comments (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="min-h-16 resize-none text-sm"
        />
        <div className="flex justify-end gap-2">
          <Button size="sm" onClick={handleSubmit}>
            Submit
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function MessageFeedback({
  messageId,
  reactions,
  currentUserId,
  onReact,
  onDeleteFeedback,
}: MessageFeedbackProps) {
  const positive = reactions?.positive ?? [];
  const negative = reactions?.negative ?? [];
  // Reactions = rows without reason (unique per user), feedback = rows with reason (multiple)
  const positiveReactions = positive.filter((r) => !r.reason);
  const negativeReactions = negative.filter((r) => !r.reason);
  const hasPositiveReaction = currentUserId
    ? positiveReactions.some((r) => r.userId === currentUserId)
    : false;
  const hasNegativeReaction = currentUserId
    ? negativeReactions.some((r) => r.userId === currentUserId)
    : false;

  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const handlePositive = useCallback(() => {
    onReact?.(messageId, 'positive');
  }, [messageId, onReact]);

  const handleNegativeClick = useCallback(() => {
    // Set the reaction (toggle on if not already negative)
    if (!hasNegativeReaction) {
      onReact?.(messageId, 'negative');
    }
    setFeedbackOpen(true);
  }, [messageId, hasNegativeReaction, onReact]);

  const handleNegativeSubmit = useCallback(
    (reason: string) => {
      onReact?.(messageId, 'negative', reason);
    },
    [messageId, onReact],
  );

  const handleDeleteEntry = useCallback(
    (feedbackId: string) => {
      onDeleteFeedback?.(messageId, feedbackId);
    },
    [messageId, onDeleteFeedback],
  );

  return (
    <div className="flex h-6 items-center gap-1 text-muted-foreground">
      <div className="flex items-center gap-0.5">
        <TooltipIconButton
          tooltip="Helpful"
          className={cn(
            hasPositiveReaction && 'text-green-600 dark:text-green-400',
          )}
          onClick={handlePositive}
        >
          <ThumbsUpIcon />
        </TooltipIconButton>
        <ReactorAvatars reactors={positiveReactions} variant="positive" />
      </div>
      <div className="flex items-center gap-0.5">
        <NegativeFeedbackPopover
          open={feedbackOpen}
          onOpenChange={setFeedbackOpen}
          onSubmit={handleNegativeSubmit}
          onDeleteEntry={handleDeleteEntry}
          allNegativeReactors={negative}
          currentUserId={currentUserId}
        >
          <TooltipIconButton
            tooltip="Not helpful"
            className={cn(
              hasNegativeReaction && 'text-red-600 dark:text-red-400',
            )}
            onClick={handleNegativeClick}
          >
            <ThumbsDownIcon />
          </TooltipIconButton>
        </NegativeFeedbackPopover>
        <ReactorAvatars reactors={negativeReactions} variant="negative" />
      </div>
    </div>
  );
}
