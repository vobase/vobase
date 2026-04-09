import DOMPurify from 'dompurify';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileIcon,
} from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { MessageRow, SenderInfo } from './types';

// ─── Types ────────────────────────────────────────────────────────────

interface EmailAttachment {
  name: string;
  size?: number;
  url?: string;
}

interface EmailContentData {
  from?: string;
  to?: string | string[];
  cc?: string | string[];
  subject?: string;
  htmlBody?: string;
  attachments?: EmailAttachment[];
}

export interface EmailMessageProps {
  message: MessageRow;
  sender?: SenderInfo;
  className?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────

const CC_COLLAPSE_THRESHOLD = 3;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toStringArray(val: string | string[] | undefined): string[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

// ─── Attachment badge ─────────────────────────────────────────────────

function AttachmentBadge({ attachment }: { attachment: EmailAttachment }) {
  const label = attachment.size
    ? `${attachment.name} (${formatBytes(attachment.size)})`
    : attachment.name;

  if (attachment.url) {
    return (
      <a
        href={attachment.url}
        download={attachment.name}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1 text-xs text-foreground hover:bg-muted transition-colors"
      >
        <FileIcon className="h-3 w-3 text-muted-foreground shrink-0" />
        {label}
      </a>
    );
  }
  return (
    <span className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
      <FileIcon className="h-3 w-3 shrink-0" />
      {label}
    </span>
  );
}

// ─── Header row ───────────────────────────────────────────────────────

function HeaderRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
      <span className="w-6 shrink-0 font-medium">{label}</span>
      {children}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────

export const EmailMessage = memo(function EmailMessage({
  message,
  sender,
  className,
}: EmailMessageProps) {
  const [ccExpanded, setCcExpanded] = useState(false);
  const [showReplies, setShowReplies] = useState(false);

  const data = (message.contentData ?? {}) as EmailContentData;
  const toList = toStringArray(data.to);
  const ccList = toStringArray(data.cc);

  const { mainHtml, quotedHtml } = useMemo(() => {
    const raw = data.htmlBody;
    if (!raw) return { mainHtml: null, quotedHtml: null };
    const sanitized = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
    const idx = sanitized.indexOf('<blockquote');
    if (idx === -1) return { mainHtml: sanitized, quotedHtml: null };
    return {
      mainHtml: sanitized.slice(0, idx),
      quotedHtml: sanitized.slice(idx),
    };
  }, [data.htmlBody]);

  const ccVisible = ccExpanded ? ccList : ccList.slice(0, CC_COLLAPSE_THRESHOLD);
  const hasCcOverflow = ccList.length > CC_COLLAPSE_THRESHOLD;

  return (
    <div className={cn('rounded-lg border bg-background overflow-hidden', className)}>
      {/* Email header */}
      <div className="px-4 pt-3 pb-2 border-b space-y-1.5 bg-muted/30">
        {data.subject && (
          <p className="text-sm font-semibold text-foreground leading-snug">
            {data.subject}
          </p>
        )}

        {data.from && (
          <HeaderRow label="From">
            <span className="text-foreground">{data.from}</span>
          </HeaderRow>
        )}

        {toList.length > 0 && (
          <HeaderRow label="To">
            <span className="text-foreground">{toList.join(', ')}</span>
          </HeaderRow>
        )}

        {ccList.length > 0 && (
          <HeaderRow label="CC">
            <span className="flex flex-wrap gap-x-1.5 gap-y-0.5">
              {ccVisible.map((addr) => (
                <span key={addr} className="text-foreground">
                  {addr}
                </span>
              ))}
              {hasCcOverflow && (
                <button
                  type="button"
                  onClick={() => setCcExpanded(!ccExpanded)}
                  className="text-primary hover:underline"
                >
                  {ccExpanded
                    ? 'less'
                    : `+${ccList.length - CC_COLLAPSE_THRESHOLD} more`}
                </button>
              )}
            </span>
          </HeaderRow>
        )}

        <div className="flex items-center justify-between pt-0.5">
          <span className="text-[10px] text-muted-foreground">
            {sender?.name ?? 'Unknown'}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {formatRelativeTime(message.createdAt)}
          </span>
        </div>
      </div>

      {/* Email body */}
      <div className="px-4 py-3">
        {mainHtml !== null ? (
          <div
            className="prose prose-sm max-w-none dark:prose-invert text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
            dangerouslySetInnerHTML={{ __html: mainHtml }}
          />
        ) : (
          <p className="text-sm whitespace-pre-wrap text-foreground">
            {message.content}
          </p>
        )}

        {/* Quoted replies toggle */}
        {quotedHtml && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowReplies(!showReplies)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showReplies ? (
                <ChevronDownIcon className="h-3 w-3" />
              ) : (
                <ChevronRightIcon className="h-3 w-3" />
              )}
              {showReplies ? 'Hide previous replies' : 'Show previous replies'}
            </button>
            {showReplies && (
              <div
                className="mt-2 border-l-2 border-muted-foreground/30 pl-3 prose prose-sm max-w-none dark:prose-invert text-sm opacity-70 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                dangerouslySetInnerHTML={{ __html: quotedHtml }}
              />
            )}
          </div>
        )}
      </div>

      {/* Attachments */}
      {data.attachments && data.attachments.length > 0 && (
        <div className="border-t px-4 py-2.5 flex flex-wrap gap-2">
          {data.attachments.map((att, i) => (
            <AttachmentBadge
              // biome-ignore lint/suspicious/noArrayIndexKey: attachment names may not be unique
              key={`${att.name}-${i}`}
              attachment={att}
            />
          ))}
        </div>
      )}
    </div>
  );
});
