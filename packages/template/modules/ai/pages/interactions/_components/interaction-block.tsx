import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  XCircleIcon,
} from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import {
  AssigneeBadge,
  ChannelBadge,
  ModeBadge,
  PriorityBadge,
  StatusBadge,
} from '@/components/interaction-badges';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { isTimelineVisibleEvent } from '@/lib/activity-helpers';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ActivityMessage } from './activity-message';
import { EmailMessage } from './email-message';
import { IncomingMessage } from './incoming-message';
import { OutgoingMessage } from './outgoing-message';
import type { MessageRow, SenderInfo, TimelineInteractionFull } from './types';

// ─── Channel accent colors ────────────────────────────────────────────

const CHANNEL_LINE_ACTIVE: Record<string, string> = {
  whatsapp: 'bg-emerald-500 dark:bg-emerald-400',
  email: 'bg-blue-500 dark:bg-blue-400',
  web: 'bg-violet-500 dark:bg-violet-400',
  voice: 'bg-amber-500 dark:bg-amber-400',
};

const LONG_THREAD_THRESHOLD = 50;
const LONG_THREAD_PREVIEW = 10;
const COLLAPSED_PREVIEW_COUNT = 3;

// ─── Reply state ──────────────────────────────────────────────────────

interface ReplyToMessage {
  messageId: string;
  senderName: string;
  contentPreview: string;
}

// ─── Props ────────────────────────────────────────────────────────────

interface InteractionBlockProps {
  interaction: TimelineInteractionFull;
  messages: MessageRow[];
  senderMap: Map<string, SenderInfo>;
  isExpanded: boolean;
  currentUserId?: string;
  onToggle: () => void;
  onUpdateInteraction: (body: {
    status?: string;
    mode?: string;
    priority?: string | null;
    assignee?: string | null;
  }) => void;
  onHandback: () => void;
  onSendReply: (
    content: string,
    isInternal: boolean,
    replyToMessageId?: string,
  ) => void;
  onRetryMessage: (messageId: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────

export const InteractionBlock = memo(function InteractionBlock({
  interaction,
  messages,
  senderMap,
  isExpanded,
  currentUserId,
  onToggle,
  onUpdateInteraction,
  onHandback,
  onSendReply: _onSendReply,
  onRetryMessage,
}: InteractionBlockProps) {
  const [showAll, setShowAll] = useState(false);
  const [_replyTo, setReplyTo] = useState<ReplyToMessage | null>(null);

  const isTerminal =
    interaction.status === 'resolved' || interaction.status === 'failed';
  const accentClass = CHANNEL_LINE_ACTIVE[interaction.channelType];

  // Filter and sort messages — same logic as MessageTimeline
  const visibleMessages = useMemo(
    () =>
      [...messages]
        .filter(
          (msg) =>
            msg.messageType !== 'activity' ||
            isTimelineVisibleEvent(msg.content),
        )
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        ),
    [messages],
  );

  // Long-thread truncation
  const exceedsThreshold =
    visibleMessages.length > LONG_THREAD_THRESHOLD && !showAll;
  const displayMessages = exceedsThreshold
    ? visibleMessages.slice(-LONG_THREAD_PREVIEW)
    : visibleMessages;

  // Collapsed state: last few non-activity messages as text preview
  const collapsedPreview = useMemo(
    () =>
      visibleMessages
        .filter((m) => m.messageType !== 'activity')
        .slice(-COLLAPSED_PREVIEW_COUNT),
    [visibleMessages],
  );

  // Date range label in header
  const startLabel = formatDate(interaction.startedAt, {
    month: 'short',
    day: 'numeric',
  });
  const endLabel = interaction.resolvedAt
    ? formatDate(interaction.resolvedAt, { month: 'short', day: 'numeric' })
    : null;
  const dateRange =
    endLabel && endLabel !== startLabel
      ? `${startLabel} – ${endLabel}`
      : startLabel;

  const title = interaction.channelLabel ?? 'Interaction';

  const handleReplyClick = (
    messageId: string,
    senderName: string,
    contentPreview: string,
  ) => {
    setReplyTo({ messageId, senderName, contentPreview });
  };

  return (
    <div className="relative pl-3">
      {/* Left accent border */}
      <div
        className={cn(
          'absolute left-0 top-0 bottom-0 w-0.5 rounded-full',
          isExpanded && accentClass ? accentClass : 'bg-border',
        )}
      />

      <div className="rounded-lg border bg-card overflow-hidden">
        {/* Header Row 1 — always visible, full row click toggles */}
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
        >
          {isExpanded ? (
            <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <ChannelBadge type={interaction.channelType} />
          <span className="flex-1 text-sm font-medium truncate">{title}</span>
          <StatusBadge status={interaction.status} />
          <span className="text-xs text-muted-foreground shrink-0">
            {dateRange}
          </span>
        </button>

        {/* Header Row 2 — active interactions only, stopPropagation prevents toggle */}
        {!isTerminal && (
          // biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation container, not interactive itself
          // biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation container only
          <div
            className="flex items-center gap-1 border-t px-3 py-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <ModeBadge
              mode={interaction.mode}
              variant="field"
              onSelect={(v) =>
                onUpdateInteraction({
                  mode: v as 'ai' | 'supervised' | 'human' | 'held',
                })
              }
            />
            <PriorityBadge
              priority={interaction.priority}
              variant="field"
              onSelect={(v) =>
                onUpdateInteraction({
                  priority: v as 'low' | 'normal' | 'high' | 'urgent' | null,
                })
              }
            />
            <Separator orientation="vertical" className="h-4 mx-0.5" />
            <AssigneeBadge
              assignee={interaction.assignee}
              isMe={!!currentUserId && interaction.assignee === currentUserId}
              variant="field"
              onAssign={() =>
                onUpdateInteraction({ assignee: currentUserId ?? null })
              }
              onUnassign={() => onUpdateInteraction({ assignee: null })}
            />
            <div className="flex-1" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <EllipsisIcon className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={() => onUpdateInteraction({ status: 'resolved' })}
                  className="gap-2 text-sm"
                >
                  <CheckIcon className="h-3.5 w-3.5" />
                  Mark resolved
                </DropdownMenuItem>
                {(interaction.mode === 'human' ||
                  interaction.mode === 'supervised' ||
                  interaction.mode === 'held') && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={onHandback}
                      className="gap-2 text-sm"
                    >
                      <BotIcon className="h-3.5 w-3.5 text-violet-500" />
                      Hand back to AI
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="gap-2 text-xs text-destructive focus:text-destructive"
                  onClick={() => onUpdateInteraction({ status: 'failed' })}
                >
                  <XCircleIcon className="h-3.5 w-3.5" />
                  Kill interaction
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* Body */}
        {isExpanded ? (
          <div className="border-t px-3 py-3 flex flex-col gap-4 animate-in fade-in-0 slide-in-from-top-1 duration-150">
            {exceedsThreshold && (
              <div className="flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground"
                  onClick={() => setShowAll(true)}
                >
                  Load earlier messages
                </Button>
              </div>
            )}
            {displayMessages.map((msg) => (
              <BlockMessageItem
                key={msg.id}
                message={msg}
                senderMap={senderMap}
                currentUserId={currentUserId}
                channelType={interaction.channelType}
                onRetry={onRetryMessage}
                onReplyClick={handleReplyClick}
              />
            ))}
          </div>
        ) : (
          collapsedPreview.length > 0 && (
            // biome-ignore lint/a11y/useKeyWithClickEvents: preview area is supplemental; toggle button above handles keyboard
            // biome-ignore lint/a11y/noStaticElementInteractions: supplemental click target, keyboard handled by header button
            <div
              className="border-t px-3 py-2 flex flex-col gap-1 cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={onToggle}
            >
              {collapsedPreview.map((msg) => (
                <CollapsedPreviewRow
                  key={msg.id}
                  message={msg}
                  senderMap={senderMap}
                  currentUserId={currentUserId}
                />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
});

// ─── Message dispatcher ───────────────────────────────────────────────

const BlockMessageItem = memo(function BlockMessageItem({
  message,
  senderMap,
  currentUserId,
  channelType,
  onRetry,
  onReplyClick,
}: {
  message: MessageRow;
  senderMap: Map<string, SenderInfo>;
  currentUserId?: string;
  channelType?: string;
  onRetry?: (messageId: string) => void;
  onReplyClick?: (
    messageId: string,
    senderName: string,
    contentPreview: string,
  ) => void;
}) {
  const sender = senderMap.get(message.senderId);

  if (message.messageType === 'activity') {
    return <ActivityMessage message={message} />;
  }

  // Email channel: use native email renderer for all non-activity messages
  if (channelType === 'email') {
    return <EmailMessage message={message} sender={sender} />;
  }

  const isMe =
    !!currentUserId &&
    message.senderType === 'user' &&
    message.senderId === currentUserId;

  if (isMe) {
    return (
      <OutgoingMessage
        message={message}
        sender={sender}
        onRetry={onRetry}
        onReplyClick={onReplyClick}
        align="right"
      />
    );
  }

  if (message.messageType === 'incoming') {
    return (
      <IncomingMessage
        message={message}
        sender={sender}
        onReplyClick={onReplyClick}
      />
    );
  }

  return (
    <OutgoingMessage
      message={message}
      sender={sender}
      onRetry={onRetry}
      onReplyClick={onReplyClick}
    />
  );
});

// ─── Collapsed preview row ────────────────────────────────────────────

function CollapsedPreviewRow({
  message,
  senderMap,
  currentUserId,
}: {
  message: MessageRow;
  senderMap: Map<string, SenderInfo>;
  currentUserId?: string;
}) {
  const sender = senderMap.get(message.senderId);
  const isMe =
    !!currentUserId &&
    message.senderType === 'user' &&
    message.senderId === currentUserId;

  const senderLabel =
    sender?.name ??
    (message.senderType === 'agent'
      ? 'Agent'
      : isMe
        ? 'You'
        : message.messageType === 'incoming'
          ? 'Customer'
          : 'Staff');

  const preview =
    message.content.slice(0, 80) + (message.content.length > 80 ? '…' : '');

  return (
    <div className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
      <span className="font-medium text-foreground/70 shrink-0">
        {senderLabel}:
      </span>
      <span className="truncate">{preview}</span>
    </div>
  );
}
