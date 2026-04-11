import {
  BotIcon,
  CornerUpLeftIcon,
  ShieldCheckIcon,
  UserIcon,
} from 'lucide-react';
import { memo } from 'react';

import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import { ChannelBadge } from '@/components/conversation-badges';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { RelativeTimeCard } from '@/components/ui/relative-time-card';
import { cn } from '@/lib/utils';
import { DeliveryStatus } from './delivery-status';
import { MediaContent, parseMedia } from './media-content';
import { PrivateNoteWrapper } from './private-note-wrapper';
import type { MessageRow, SenderInfo } from './types';

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
}

export const OutgoingMessage = memo(function OutgoingMessage({
  message,
  sender,
  onRetry,
  onReplyClick,
  className,
  align = 'left',
  channelType,
}: OutgoingMessageProps) {
  const isAgent = message.senderType === 'agent';
  const isStaff = message.senderType === 'user';
  const isSystem = message.senderType === 'system';
  const isWithdrawn = message.withdrawn;
  const isPrivate = message.private;
  const isDraft = message.resolutionStatus === 'pending';

  const defaultLabel = isAgent
    ? 'Agent'
    : isStaff
      ? 'Staff'
      : isSystem
        ? 'System'
        : 'Unknown';
  const senderLabel = sender?.name ?? defaultLabel;

  const SenderIcon = isAgent ? BotIcon : isStaff ? UserIcon : ShieldCheckIcon;

  // Extract interactive buttons from contentData if present
  const interactive = message.contentData?.interactive as
    | {
        type: string;
        body?: { text: string };
        action?: {
          buttons?: Array<{ reply: { id: string; title: string } }>;
        };
      }
    | undefined;
  const replyButtons = interactive?.action?.buttons;

  const content = (
    <MessageContent>
      {isWithdrawn ? (
        <span className="text-sm text-muted-foreground italic">
          Message withdrawn
        </span>
      ) : (
        <>
          {(interactive?.body?.text ?? message.content) && (
            <MessageResponse>
              {interactive?.body?.text ?? message.content}
            </MessageResponse>
          )}
          {replyButtons && replyButtons.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {replyButtons.map((btn) => (
                <span
                  key={btn.reply.id}
                  className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium text-primary"
                >
                  {btn.reply.title}
                </span>
              ))}
            </div>
          )}
          <MediaContent
            contentType={message.contentType}
            media={parseMedia(message.contentData)}
          />
        </>
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

  const contentPreview = (interactive?.body?.text ?? message.content).slice(
    0,
    100,
  );

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

  const body = isPrivate ? (
    <PrivateNoteWrapper>{content}</PrivateNoteWrapper>
  ) : (
    content
  );

  if (align === 'right') {
    return (
      <Message from="user" className={cn('items-end group', className)}>
        <div className="flex items-end gap-2 justify-end">
          <div className="flex flex-col items-end gap-1 min-w-0">
            {meta}
            {body}
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
          {body}
        </div>
      </div>
    </Message>
  );
});
