import { memo } from 'react';

import { MessageResponse } from '@/components/ai-elements/message';
import { Badge } from '@/components/ui/badge';
import { MediaContent, parseMedia } from './media-content';
import type { MessageRow } from './types';

interface WhatsAppOutgoingContentProps {
  message: MessageRow;
}

/** WhatsApp-specific content: templates, interactive buttons, and echo attribution. */
export const WhatsAppOutgoingContent = memo(function WhatsAppOutgoingContent({
  message,
}: WhatsAppOutgoingContentProps) {
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

  const template = message.contentData?.template as
    | {
        name?: string;
        language?: { code?: string };
        components?: Array<{
          type: string;
          parameters?: Array<{ type: string; text?: string }>;
        }>;
      }
    | undefined;
  const templateBodyParams = template?.components
    ?.find((c) => c.type === 'body')
    ?.parameters?.filter((p) => p.type === 'text' && p.text != null)
    ?.map((p) => p.text as string);

  if (template) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <Badge
            variant="secondary"
            className="h-4 px-1.5 text-[10px] font-medium"
          >
            Template
          </Badge>
          {template.name && (
            <span className="text-xs text-muted-foreground font-mono">
              {template.name}
            </span>
          )}
        </div>
        {message.content && (
          <MessageResponse>{message.content}</MessageResponse>
        )}
        {templateBodyParams && templateBodyParams.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {templateBodyParams.map((param, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: template params are positional, no stable id
                key={i}
                className="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground bg-muted/50"
              >
                {param}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
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
  );
});

/** Returns true if this message has WhatsApp-specific content to render. */
export function isWhatsAppContent(message: MessageRow): boolean {
  return !!(
    message.contentData?.template ||
    message.contentData?.interactive ||
    message.senderId === 'echo'
  );
}

/** Echo attribution for messages sent via WhatsApp Business App. */
export function WhatsAppEchoAttribution() {
  return (
    <span className="text-xs text-muted-foreground">
      Sent via WhatsApp Business App
    </span>
  );
}
