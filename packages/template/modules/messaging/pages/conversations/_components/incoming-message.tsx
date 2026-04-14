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
import {
  MediaContent,
  parseContentMetadata,
  parseMedia,
} from './media-content';
import { MessageReactions } from './message-reactions';
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

  // WhatsApp sends single \n for line breaks; the markdown renderer needs \n\n
  // for paragraph breaks. Only double lone \n — preserve existing \n\n sequences.
  const displayContent =
    channelType === 'whatsapp'
      ? message.content.replace(/(?<!\n)\n(?!\n)/g, '\n\n')
      : message.content;

  const contentMetadata = parseContentMetadata(message.contentData);

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
          <MessageContent
            className={cn(
              'rounded-lg bg-muted/50 px-3 py-2',
              isWithdrawn && 'opacity-50 italic',
            )}
          >
            {isWithdrawn ? (
              <span className="text-sm text-muted-foreground italic">
                Message withdrawn
              </span>
            ) : (
              <>
                {displayContent && (
                  <MessageResponse>{displayContent}</MessageResponse>
                )}
                <MediaContent
                  contentType={message.contentType}
                  media={parseMedia(message.contentData)}
                  metadata={contentMetadata}
                  mediaDownloadFailed={!!contentMetadata?.mediaDownloadFailed}
                />
              </>
            )}
          </MessageContent>
          {Array.isArray(message.contentData?.reactions) && (
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
          )}
        </div>
      </div>
    </Message>
  );
});
