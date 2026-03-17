import { Bot } from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { MarkdownRenderer } from './markdown-renderer';
import { SourceCitation } from './source-citation';

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  sources?: Array<{ documentTitle: string; relevanceScore?: number }>;
  userName?: string;
  timestamp?: string;
}

function userInitials(name?: string): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export function MessageBubble({
  role,
  content,
  sources,
  userName,
  timestamp,
}: MessageBubbleProps) {
  const isUser = role === 'user';

  return (
    <div className={cn('flex items-start gap-2', isUser && 'flex-row-reverse')}>
      {/* Avatar */}
      {isUser ? (
        <Avatar size="sm" className="mt-0.5 shrink-0">
          <AvatarFallback className="bg-primary text-primary-foreground text-xs">
            {userInitials(userName)}
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Bot className="size-3.5" />
        </div>
      )}

      {/* Bubble + timestamp */}
      <div
        className={cn('flex max-w-[75%] flex-col gap-1', isUser && 'items-end')}
      >
        <div
          className={cn(
            'rounded-lg px-3 py-2',
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-foreground',
          )}
        >
          {isUser ? (
            <p className="text-sm whitespace-pre-wrap break-words">{content}</p>
          ) : (
            <MarkdownRenderer content={content} />
          )}

          {!isUser && sources && sources.length > 0 && (
            <SourceCitation sources={sources} />
          )}
        </div>

        {timestamp && (
          <span className="text-xs text-muted-foreground px-1">
            {timestamp}
          </span>
        )}
      </div>
    </div>
  );
}
