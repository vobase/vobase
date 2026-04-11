import { CornerUpLeftIcon, UserIcon } from 'lucide-react';
import { memo } from 'react';

import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import { ChannelBadge } from '@/components/conversation-badges';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RelativeTimeCard } from '@/components/ui/relative-time-card';
import { cn } from '@/lib/utils';
import { MediaContent, parseMedia } from './media-content';
import type { MessageRow, SenderInfo } from './types';

interface IncomingMessageProps {
  message: MessageRow;
  sender?: SenderInfo;
  onReplyClick?: (
    messageId: string,
    senderName: string,
    contentPreview: string,
  ) => void;
  className?: string;
  /** Channel type — shown as badge when contact uses multiple channels. */
  channelType?: string | null;
}

export const IncomingMessage = memo(function IncomingMessage({
  message,
  sender,
  onReplyClick,
  className,
  channelType,
}: IncomingMessageProps) {
  const isWithdrawn = message.withdrawn;
  const name = sender?.name ?? 'Customer';

  return (
    <Message from="assistant" className={cn('group', className)}>
      <div className="flex items-end gap-2">
        <Avatar className="size-7">
          <AvatarImage src={sender?.image ?? undefined} alt={name} />
          <AvatarFallback className="bg-muted text-xs font-medium text-muted-foreground">
            {sender?.name ? (
              sender.name.charAt(0).toUpperCase()
            ) : (
              <UserIcon className="size-3.5" />
            )}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{name}</span>
            {channelType && <ChannelBadge type={channelType} variant="icon" />}
            <RelativeTimeCard date={message.createdAt} />
            {onReplyClick && !isWithdrawn && (
              <button
                type="button"
                title="Reply"
                onClick={() =>
                  onReplyClick(message.id, name, message.content.slice(0, 100))
                }
                className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground"
              >
                <CornerUpLeftIcon className="h-3 w-3" />
              </button>
            )}
          </div>
          <MessageContent className={cn(isWithdrawn && 'opacity-50 italic')}>
            {isWithdrawn ? (
              <span className="text-sm text-muted-foreground italic">
                Message withdrawn
              </span>
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
          </MessageContent>
        </div>
      </div>
    </Message>
  );
});
