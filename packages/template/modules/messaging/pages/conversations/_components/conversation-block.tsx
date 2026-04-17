import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  PauseIcon,
  PlayIcon,
  XCircleIcon,
} from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import type { MessageScoreGroup } from '@/components/chat/message-quality';
import {
  AssigneeBadge,
  PriorityBadge,
  StatusBadge,
} from '@/components/conversation-badges';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ResolveParticipantName } from '@/lib/activity-helpers';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { filterAndSortMessages } from '../../../lib/filter-sort-messages';
import type { ConversationScoresByMessage } from '../../inbox/_hooks/use-conversation-scores';
import { ActivityMessage } from './activity-message';
import { EmailMessage } from './email-message';
import { IncomingMessage } from './incoming-message';
import { OutgoingMessage } from './outgoing-message';
import type { MessageRow, SenderInfo, TimelineConversationFull } from './types';

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

interface ConversationBlockProps {
  conversation: TimelineConversationFull;
  messages: MessageRow[];
  senderMap: Map<string, SenderInfo>;
  isExpanded: boolean;
  currentUserId?: string;
  agents?: Array<{ id: string; name: string }>;
  teamMembers?: Array<{ id: string; name: string }>;
  resolveName?: ResolveParticipantName;
  onToggle: () => void;
  onUpdateConversation: (body: {
    status?: string;
    priority?: string | null;
    assignee?: string | null;
    onHold?: boolean;
  }) => void;
  onRetryMessage: (messageId: string) => void;
  /** Quality scores keyed by agent message ID for this conversation. */
  scores?: ConversationScoresByMessage | null;
}

// ─── Component ────────────────────────────────────────────────────────

export const ConversationBlock = memo(function ConversationBlock({
  conversation,
  messages,
  senderMap,
  isExpanded,
  currentUserId,
  agents = [],
  teamMembers = [],
  resolveName: resolveNameProp,
  onToggle,
  onUpdateConversation,
  onRetryMessage,
  scores,
}: ConversationBlockProps) {
  const [showAll, setShowAll] = useState(false);
  const [_replyTo, setReplyTo] = useState<ReplyToMessage | null>(null);

  const resolveName = useMemo<ResolveParticipantName>(() => {
    if (resolveNameProp) return resolveNameProp;
    const map = new Map<string, string>();
    for (const m of teamMembers) map.set(m.id, m.name);
    for (const a of agents) {
      map.set(a.id, a.name);
      map.set(`agent:${a.id}`, a.name);
    }
    return (id: string) => map.get(id);
  }, [resolveNameProp, teamMembers, agents]);

  const isTerminal =
    conversation.status === 'resolved' || conversation.status === 'failed';
  const accentClass = CHANNEL_LINE_ACTIVE[conversation.channelType];

  const visibleMessages = useMemo(
    () => filterAndSortMessages(messages),
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
  const startLabel = formatDate(conversation.startedAt, {
    month: 'short',
    day: 'numeric',
  });
  const endLabel = conversation.resolvedAt
    ? formatDate(conversation.resolvedAt, { month: 'short', day: 'numeric' })
    : null;
  const dateRange =
    endLabel && endLabel !== startLabel
      ? `${startLabel} – ${endLabel}`
      : startLabel;

  const title = conversation.channelLabel ?? 'Conversation';

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
        {/* Header — single row with toggle, title, actions */}
        <div className="flex items-center gap-1.5 px-3 py-2">
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-1.5 min-w-0 flex-1 text-left hover:opacity-80 transition-opacity"
          >
            {isExpanded ? (
              <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="text-sm font-medium truncate">{title}</span>
            <StatusBadge status={conversation.status} />
            <span className="text-xs text-muted-foreground shrink-0">
              {dateRange}
            </span>
          </button>

          {/* Inline actions for active conversations */}
          {!isTerminal && (
            <div
              className="flex items-center gap-0.5 shrink-0"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              role="toolbar"
              aria-label="Conversation actions"
            >
              <AssigneeBadge
                assignee={conversation.assignee}
                variant="field"
                onSelect={(v) => onUpdateConversation({ assignee: v })}
                agents={agents}
                teamMembers={teamMembers}
              />
              <PriorityBadge
                priority={conversation.priority}
                variant="field"
                onSelect={(v) =>
                  onUpdateConversation({
                    priority: v as 'low' | 'normal' | 'high' | 'urgent' | null,
                  })
                }
              />
              <Button
                variant={conversation.onHold ? 'secondary' : 'ghost'}
                size="sm"
                className={cn(
                  'h-7 gap-1.5 text-xs',
                  conversation.onHold && 'text-amber-600 dark:text-amber-400',
                )}
                onClick={() =>
                  onUpdateConversation({ onHold: !conversation.onHold })
                }
              >
                {conversation.onHold ? (
                  <PlayIcon className="h-3 w-3" />
                ) : (
                  <PauseIcon className="h-3 w-3" />
                )}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <EllipsisIcon className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem
                    onClick={() => onUpdateConversation({ status: 'resolved' })}
                    className="gap-2 text-sm"
                  >
                    <CheckIcon className="h-3.5 w-3.5" />
                    Mark resolved
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="gap-2 text-xs text-destructive focus:text-destructive"
                    onClick={() => onUpdateConversation({ status: 'failed' })}
                  >
                    <XCircleIcon className="h-3.5 w-3.5" />
                    Kill conversation
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {/* Body */}
        {isExpanded ? (
          <div className="border-t px-3 py-3 flex flex-col gap-6 animate-in fade-in-0 slide-in-from-top-1 duration-150">
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
                channelType={conversation.channelType}
                onRetry={onRetryMessage}
                onReplyClick={handleReplyClick}
                scores={scores?.get(msg.id)}
                resolveName={resolveName}
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

export const BlockMessageItem = memo(function BlockMessageItem({
  message,
  senderMap,
  currentUserId,
  channelType,
  onRetry,
  onReplyClick,
  scores,
  resolveName,
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
  scores?: MessageScoreGroup | null;
  resolveName?: ResolveParticipantName;
}) {
  const sender = senderMap.get(message.senderId);

  if (message.messageType === 'activity') {
    return <ActivityMessage message={message} resolveName={resolveName} />;
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
      scores={scores}
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
