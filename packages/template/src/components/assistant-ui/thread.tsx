import {
  ActionBarPrimitive,
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadPrimitive,
  type ToolCallMessagePartComponent,
  useAuiState,
} from '@assistant-ui/react';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  LoaderIcon,
  LockIcon,
  SquareIcon,
} from 'lucide-react';
import type { FC } from 'react';

import { StreamdownText } from '@/components/assistant-ui/streamdown-text';
import { ToolFallback } from '@/components/assistant-ui/tool-fallback';
import { TooltipIconButton } from '@/components/assistant-ui/tooltip-icon-button';
import { KbCurationOverlay } from '@/components/chat/kb-curation-overlay';
import { MessageFeedback } from '@/components/chat/message-feedback';
import { MessageQualityIndicator } from '@/components/chat/message-quality';
import { TypingIndicator } from '@/components/chat/typing-indicator';
import { useVobaseThread } from '@/components/chat/vobase-thread-context';
import { Button } from '@/components/ui/button';
import { activityIcon } from '@/lib/activity-helpers';
import { formatRelativeTime } from '@/lib/format';
import { isInternalNote } from '@/lib/normalize-message';
import { cn } from '@/lib/utils';
import { useStaffChatStore } from '@/stores/staff-chat-store';

// ─── Full Thread (with composer) ────────────────────────────────────

export const Thread: FC = () => {
  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root @container flex h-full flex-col bg-background text-sm"
      style={{ ['--thread-max-width' as string]: '44rem' }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        className="thin-scrollbar relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth px-4 pt-4"
      >
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <ThreadWelcome />
        </AuiIf>

        <ThreadPrimitive.Messages>
          {() => <ThreadMessage />}
        </ThreadPrimitive.Messages>

        <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mx-auto mt-auto flex w-full max-w-(--thread-max-width) flex-col gap-4 overflow-visible rounded-t-3xl bg-background pb-4 md:pb-6">
          <ThreadScrollToBottom />
          <Composer />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

// ─── Messages-only Thread (no composer) ─────────────────────────────

export const ThreadMessages: FC = () => {
  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root @container flex h-full flex-col bg-background text-sm"
      style={{ ['--thread-max-width' as string]: '44rem' }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        className="thin-scrollbar relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth px-4 pt-4"
      >
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <ThreadWelcome />
        </AuiIf>

        <ThreadPrimitive.Messages>
          {() => <ThreadMessage />}
        </ThreadPrimitive.Messages>

        <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mx-auto mt-auto flex w-full max-w-(--thread-max-width) flex-col gap-4 overflow-visible bg-background pb-4">
          <ThreadScrollToBottom />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
      <ThreadTypingIndicator />
    </ThreadPrimitive.Root>
  );
};

// ─── Message Routing ────────────────────────────────────────────────

/** Look up the original NormalizedMessage by assistant-ui message ID */
function useOriginalMessage() {
  const ctx = useVobaseThread();
  const id = useAuiState((s) => s.message.id);
  return ctx?.messages.find((m) => m.id === id) ?? null;
}

const ThreadMessage: FC = () => {
  const role = useAuiState((s) => s.message.role);
  const original = useOriginalMessage();
  const ctx = useVobaseThread();

  // Internal notes get special rendering in staff view
  if (ctx?.viewMode === 'staff' && original && isInternalNote(original)) {
    return <InternalNoteMessage original={original} />;
  }

  // Activity events rendered as inline system messages
  if (role === 'system') return <ActivityEventMessage />;

  if (role === 'user') return <UserMessage />;
  return <AssistantMessage />;
};

// ─── Internal Note ──────────────────────────────────────────────────

const InternalNoteMessage: FC<{
  original: NonNullable<ReturnType<typeof useOriginalMessage>>;
}> = ({ original }) => {
  const staffName = original.metadata.staffName ?? 'Staff';
  const text = original.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('');

  return (
    <MessagePrimitive.Root
      className="fade-in slide-in-from-bottom-1 relative mx-auto w-full max-w-(--thread-max-width) animate-in py-2 duration-150"
      data-role="internal-note"
    >
      <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/30">
        <div className="mb-1 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <LockIcon className="size-3" />
          <span className="font-medium">Internal note by {staffName}</span>
        </div>
        <p className="text-sm text-foreground">{text}</p>
      </div>
    </MessagePrimitive.Root>
  );
};

// ─── Activity Event (System Message) ────────────────────────────────

const ActivityEventMessage: FC = () => {
  const text = useAuiState((s) => {
    const parts = s.message.content;
    if (parts.length > 0 && parts[0].type === 'text') return parts[0].text;
    return '';
  });
  const createdAt = useAuiState((s) => s.message.createdAt);
  const custom = useAuiState(
    (s) => (s.message.metadata as { custom?: Record<string, unknown> })?.custom,
  );
  const activityType = (custom?.activityType as string) ?? '';

  return (
    <MessagePrimitive.Root
      className="mx-auto w-full max-w-(--thread-max-width) flex justify-center py-1"
      data-role="system"
    >
      <div className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-3 py-1 text-xs text-muted-foreground">
        {activityIcon(activityType)}
        <span>{text}</span>
        {createdAt && (
          <span className="text-muted-foreground/50 ml-0.5">
            {formatRelativeTime(createdAt)}
          </span>
        )}
      </div>
    </MessagePrimitive.Root>
  );
};

// ─── Typing Indicator ───────────────────────────────────────────────

const ThreadTypingIndicator: FC = () => {
  const ctx = useVobaseThread();
  if (!ctx?.interactionId) return null;

  return (
    <div className="mx-auto w-full max-w-(--thread-max-width) px-4">
      <TypingIndicator
        interactionId={ctx.interactionId}
        isAiThinking={ctx.isAiThinking}
        excludeUserId={ctx.currentUserId}
      />
    </div>
  );
};

// ─── Scroll to Bottom ───────────────────────────────────────────────

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

// ─── Welcome ────────────────────────────────────────────────────────

const ThreadWelcome: FC = () => {
  return (
    <div className="mx-auto my-auto flex w-full max-w-(--thread-max-width) grow flex-col">
      <div className="flex w-full grow flex-col items-center justify-center">
        <div className="flex size-full flex-col justify-center px-4">
          <h1 className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both font-medium text-lg duration-200">
            Hello there!
          </h1>
          <p className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-muted-foreground/65 text-base delay-75 duration-200">
            How can I help you today?
          </p>
        </div>
      </div>
      <div className="grid w-full gap-2 pb-4 @md:grid-cols-2">
        <ThreadPrimitive.Suggestions>
          {() => (
            <SuggestionPrimitive.Trigger send asChild>
              <Button
                variant="ghost"
                className="h-auto w-full flex-col items-start justify-start gap-1 rounded-xl border bg-background px-5 py-4 text-left text-sm transition-colors hover:bg-muted"
              >
                <SuggestionPrimitive.Title className="font-medium" />
                <SuggestionPrimitive.Description className="text-muted-foreground empty:hidden" />
              </Button>
            </SuggestionPrimitive.Trigger>
          )}
        </ThreadPrimitive.Suggestions>
      </div>
    </div>
  );
};

// ─── Composer ────────────────────────────────────────────────────────

const Composer: FC = () => {
  return (
    <ComposerPrimitive.Root className="relative flex w-full flex-col">
      <div className="flex w-full flex-col gap-2 rounded-xl border bg-background px-1 pt-2 transition-shadow focus-within:border-ring/75 focus-within:ring-2 focus-within:ring-ring/20">
        <ComposerPrimitive.Input
          placeholder="Send a message..."
          className="mb-1 max-h-32 min-h-10 w-full resize-none bg-transparent px-4 pt-2 pb-3 text-sm outline-none placeholder:text-muted-foreground/80"
          rows={1}
          autoFocus
          aria-label="Message input"
        />
        <ComposerAction />
      </div>
    </ComposerPrimitive.Root>
  );
};

const ComposerAction: FC = () => {
  return (
    <div className="relative mx-2 mb-2 flex items-center justify-end">
      <AuiIf condition={(s) => !s.thread.isRunning}>
        <ComposerPrimitive.Send asChild>
          <TooltipIconButton
            tooltip="Send message"
            side="bottom"
            type="button"
            variant="default"
            size="icon"
            className="size-8 rounded-full"
            aria-label="Send message"
          >
            <ArrowUpIcon className="size-4" />
          </TooltipIconButton>
        </ComposerPrimitive.Send>
      </AuiIf>
      <AuiIf condition={(s) => s.thread.isRunning}>
        <ComposerPrimitive.Cancel asChild>
          <Button
            type="button"
            variant="default"
            size="icon"
            className="size-8 rounded-full"
            aria-label="Stop generating"
          >
            <SquareIcon className="size-3 fill-current" />
          </Button>
        </ComposerPrimitive.Cancel>
      </AuiIf>
    </div>
  );
};

/** ToolFallback wrapped with vertical spacing between consecutive tool calls */
const ToolFallbackWithSpacing: ToolCallMessagePartComponent = (props) => (
  <div className="my-2">
    <ToolFallback {...props} />
  </div>
);

// ─── Message Error ──────────────────────────────────────────────────

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-destructive text-sm dark:bg-destructive/5 dark:text-red-200">
        <ErrorPrimitive.Message className="line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

// ─── Assistant Message ──────────────────────────────────────────────

const AssistantMessage: FC = () => {
  const ctx = useVobaseThread();
  const messageId = useAuiState((s) => s.message.id);
  const original = useOriginalMessage();
  const kbCurationStoreValue = useStaffChatStore((s) => s.kbCurationActive);
  const kbCurationActive = ctx?.viewMode === 'staff' && kbCurationStoreValue;

  // Detect staff replies from normalized metadata or assistant-ui content
  const isStaffMessage = original?.metadata.isStaffReply ?? false;

  const messageText =
    original?.parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('') ?? '';

  const deliveryStatus =
    ctx?.viewMode === 'staff' ? original?.metadata.deliveryStatus : undefined;

  return (
    <MessagePrimitive.Root
      className="fade-in slide-in-from-bottom-1 relative mx-auto w-full max-w-(--thread-max-width) animate-in py-3 duration-150"
      data-role="assistant"
    >
      <div
        className={cn(
          isStaffMessage &&
            'my-1 rounded-lg border border-muted-foreground/20 bg-muted/30 px-3 py-3',
        )}
      >
        {deliveryStatus && (
          <span
            className={cn(
              'text-xs px-2 mb-0.5 block',
              deliveryStatus === 'delivered' || deliveryStatus === 'read'
                ? 'text-green-600 dark:text-green-400'
                : deliveryStatus === 'failed'
                  ? 'text-destructive'
                  : 'text-muted-foreground',
            )}
          >
            {deliveryStatus}
          </span>
        )}

        <div
          className={cn(
            'relative break-words px-2 leading-relaxed text-foreground',
            kbCurationActive && 'pl-8',
          )}
        >
          {kbCurationActive && (
            <KbCurationOverlay
              messageId={messageId}
              messageText={messageText}
            />
          )}

          <MessagePrimitive.Parts
            components={{
              Text: StreamdownText,
              tools: { Fallback: ToolFallbackWithSpacing },
            }}
          />
          <MessageError />

          <AuiIf
            condition={(s) =>
              s.thread.isRunning && s.message.content.length === 0
            }
          >
            <div className="flex items-center gap-2 text-muted-foreground">
              <LoaderIcon className="size-4 animate-spin" />
              <span className="text-sm">Thinking...</span>
            </div>
          </AuiIf>
        </div>

        {!isStaffMessage && (
          <div className="mt-1 ml-2 flex min-h-6 items-center gap-2">
            <MessageFeedback
              messageId={messageId}
              reactions={ctx?.feedbackMap?.get(messageId)}
              currentUserId={ctx?.currentUserId}
              onReact={ctx?.onReact}
              onDeleteFeedback={ctx?.onDeleteFeedback}
            />
            {(() => {
              const group = ctx?.qualityScores?.get(messageId);
              return group ? <MessageQualityIndicator group={group} /> : null;
            })()}
            <AssistantActionBar />
          </div>
        )}
      </div>
    </MessagePrimitive.Root>
  );
};

// ─── Assistant Action Bar ───────────────────────────────────────────

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="-ml-1 flex gap-1 text-muted-foreground"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.ExportMarkdown asChild>
        <TooltipIconButton tooltip="Export as Markdown">
          <DownloadIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.ExportMarkdown>
    </ActionBarPrimitive.Root>
  );
};

// ─── User Message ───────────────────────────────────────────────────

const UserMessage: FC = () => {
  // Hide separator messages (inserted to break assistant-ui turn merging)
  const isSeparator = useAuiState((s) => s.message.id.startsWith('sep-'));
  if (isSeparator) return null;

  return (
    <MessagePrimitive.Root
      className="fade-in slide-in-from-bottom-1 mx-auto grid w-full max-w-(--thread-max-width) animate-in auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 py-3 duration-150"
      data-role="user"
    >
      <div className="relative col-start-2 min-w-0">
        <div className="rounded-xl bg-muted px-4 py-2.5 break-words text-foreground empty:hidden">
          <MessagePrimitive.Parts />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};
