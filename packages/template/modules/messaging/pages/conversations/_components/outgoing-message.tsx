import {
  BotIcon,
  CornerUpLeftIcon,
  LockIcon,
  ShieldCheckIcon,
  UserIcon,
} from 'lucide-react';
import { memo } from 'react';

import { CardRenderer } from '@/components/ai-elements/card-renderer';
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import {
  MessageQualityIndicator,
  type MessageScoreGroup,
} from '@/components/chat/message-quality';
import { ChannelBadge } from '@/components/conversation-badges';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { RelativeTimeCard } from '@/components/ui/relative-time-card';
import { cn } from '@/lib/utils';
import type { CardElement } from '@modules/messaging/lib/card-serialization';
import { DeliveryStatus } from './delivery-status';
import { MediaContent, parseMedia } from './media-content';
import { MessageReactions } from './message-reactions';
import type { MessageRow, SenderInfo } from './types';
import {
  isWhatsAppContent,
  WhatsAppEchoAttribution,
  WhatsAppOutgoingContent,
} from './whatsapp-outgoing';

interface OutgoingMessageProps {
  message: MessageRow;
  sender?: SenderInfo;
  onRetry?: (messageId: string) => void;
  onReplyClick?: (
    messageId: string,
    senderName: string,
    contentPreview: string,
  ) => void;
  className?: string;
  /** When "right", renders right-aligned (current staff's own messages). */
  align?: 'left' | 'right';
  /** Channel type — shown as badge when contact uses multiple channels. */
  channelType?: string | null;
  /** Quality scores to display below agent messages. */
  scores?: MessageScoreGroup | null;
}

export const OutgoingMessage = memo(function OutgoingMessage({
  message,
  sender,
  onRetry,
  onReplyClick,
  className,
  align = 'left',
  channelType,
  scores,
}: OutgoingMessageProps) {
  const isAgent = message.senderType === 'agent';
  const isStaff = message.senderType === 'user';
  const isSystem = message.senderType === 'system';
  const isWithdrawn = message.withdrawn;
  const isPrivate = message.private;
  const isDraft = message.resolutionStatus === 'pending';
  const isEcho = message.senderId === 'echo';

  const defaultLabel = isAgent
    ? 'Agent'
    : isStaff
      ? 'Staff'
      : isSystem
        ? 'System'
        : 'Unknown';
  const senderLabel = sender?.name ?? defaultLabel;

  const SenderIcon = isAgent ? BotIcon : isStaff ? UserIcon : ShieldCheckIcon;

  const isFailed = message.status === 'failed';
  const hasWhatsApp = isWhatsAppContent(message);

  const bubbleClass = cn(
    'rounded-lg',
    isPrivate ? 'px-2.5 py-1.5' : 'px-3 py-2',
    isFailed && 'border border-destructive/30 bg-destructive/5',
    !isFailed &&
      isPrivate &&
      'border border-violet-200 bg-violet-50/80 dark:border-violet-800 dark:bg-violet-950/30',
    !isFailed && !isPrivate && isAgent && 'bg-primary/10',
    !isFailed && !isPrivate && !isAgent && 'bg-muted/40',
  );

  const content = (
    <MessageContent className={bubbleClass}>
      {isPrivate && (
        <div className="flex items-center gap-1.5 text-xs font-medium text-violet-600 dark:text-violet-400">
          <LockIcon className="size-3" />
          Internal note
        </div>
      )}
      {isWithdrawn ? (
        <span className="text-sm text-muted-foreground italic">
          Message withdrawn
        </span>
      ) : hasWhatsApp ? (
        <WhatsAppOutgoingContent message={message} />
      ) : message.contentType === 'interactive' &&
        (message.contentData as Record<string, unknown>)?.card ? (
        <CardRenderer
          card={
            (message.contentData as Record<string, unknown>).card as CardElement
          }
          readOnly
          className="border-0 shadow-none p-0"
        />
      ) : (
        <>
          {message.content && (
            <MessageResponse>{message.content}</MessageResponse>
          )}
          <MediaContent
            contentType={message.contentType}
            media={parseMedia(message.contentData)}
          />
        </>
      )}
      {isFailed && message.failureReason && (
        <span className="text-xs text-destructive">
          {message.failureReason}
        </span>
      )}
    </MessageContent>
  );

  const avatar = (
    <Avatar className="size-7">
      <AvatarImage src={sender?.image ?? undefined} alt={senderLabel} />
      <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
        {sender?.name && !isAgent ? (
          sender.name.charAt(0).toUpperCase()
        ) : (
          <SenderIcon className="size-3.5" />
        )}
      </AvatarFallback>
    </Avatar>
  );

  const contentPreview = message.content.slice(0, 100);

  const meta = (
    <div
      className={cn(
        'flex items-center gap-1.5 text-xs text-muted-foreground',
        align === 'right' && 'justify-end',
      )}
    >
      <span
        className={cn(
          'font-medium',
          isAgent ? 'text-primary' : 'text-foreground',
        )}
      >
        {senderLabel}
      </span>
      {isDraft && (
        <Badge
          variant="outline"
          className="h-4 px-1.5 text-[10px] font-medium text-amber-600 border-amber-300"
        >
          Draft
        </Badge>
      )}
      {channelType && <ChannelBadge type={channelType} variant="icon" />}
      <RelativeTimeCard date={message.createdAt} />
      <DeliveryStatus
        status={message.status}
        failureReason={message.failureReason}
        onRetry={onRetry ? () => onRetry(message.id) : undefined}
      />
      {onReplyClick && !isWithdrawn && (
        <button
          type="button"
          title="Reply"
          onClick={() => onReplyClick(message.id, senderLabel, contentPreview)}
          className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground"
        >
          <CornerUpLeftIcon className="h-3 w-3" />
        </button>
      )}
    </div>
  );

  const reactions = Array.isArray(message.contentData?.reactions) && (
    <MessageReactions
      reactions={
        message.contentData.reactions as Array<{
          from: string;
          emoji: string;
          action: string;
          timestamp?: string;
        }>
      }
    />
  );

  const echoAttribution = isEcho && <WhatsAppEchoAttribution />;

  if (align === 'right') {
    return (
      <Message from="user" className={cn('items-end group', className)}>
        <div className="flex items-end gap-2 justify-end">
          <div className="flex flex-col items-end gap-1 min-w-0">
            {meta}
            {content}
            {reactions}
            {echoAttribution}
          </div>
          {avatar}
        </div>
      </Message>
    );
  }

  return (
    <Message from="assistant" className={cn('group', className)}>
      <div className="flex items-end gap-2">
        {avatar}
        <div className="flex flex-col gap-1 min-w-0">
          {meta}
          {content}
          {isAgent && scores && scores.scores.length > 0 && (
            <MessageQualityIndicator group={scores} />
          )}
          {reactions}
          {echoAttribution}
        </div>
      </div>
    </Message>
  );
});
