import {
  Plate,
  PlateContent,
  useEditorRef,
  usePlateEditor,
} from '@platejs/core/react';
import { ListStyleType } from '@platejs/list';
import {
  useListToolbarButton,
  useListToolbarButtonState,
} from '@platejs/list/react';
import {
  BoldIcon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  MessageSquareIcon,
  SendIcon,
  UnderlineIcon,
  XIcon,
} from 'lucide-react';
import { memo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  emailEditorComponents,
  emailEditorPlugins,
} from './email-editor-config';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReplyToMessage {
  messageId: string;
  senderName: string;
  contentPreview: string;
}

interface BlockReplyInputProps {
  channelType: string;
  conversationTitle?: string;
  replyToMessage?: ReplyToMessage | null;
  onClearReplyTo?: () => void;
  onSend: (
    content: string,
    isInternal: boolean,
    replyToMessageId?: string,
    emailFields?: {
      subject?: string;
      cc?: string[];
      replyAll?: boolean;
    },
  ) => void;
  isPending?: boolean;
  error?: string | null;
  /** Pre-fill the composer with draft content (e.g. from agent.draft_created). */
  initialContent?: string;
}

// ─── Email toolbar (must be inside <Plate> context) ───────────────────────────

const TOOLBAR_BTN_CLASS =
  'flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground';

function MarkBtn({
  markKey,
  title,
  children,
}: {
  markKey: string;
  title: string;
  children: React.ReactNode;
}) {
  const editor = useEditorRef();
  return (
    <button
      type="button"
      title={title}
      className={TOOLBAR_BTN_CLASS}
      onMouseDown={(e) => {
        e.preventDefault(); // keep editor focus
        editor.tf.toggleMark(markKey);
      }}
    >
      {children}
    </button>
  );
}

function ListBtn({
  listStyleType,
  title,
  children,
}: {
  listStyleType: string;
  title: string;
  children: React.ReactNode;
}) {
  const editor = useEditorRef();
  // Guard: Plate list hooks crash when editor.selection is undefined (before first focus)
  if (!editor.selection) {
    return (
      <button type="button" title={title} className={TOOLBAR_BTN_CLASS}>
        {children}
      </button>
    );
  }
  return (
    <ListBtnInner listStyleType={listStyleType} title={title}>
      {children}
    </ListBtnInner>
  );
}

function ListBtnInner({
  listStyleType,
  title,
  children,
}: {
  listStyleType: string;
  title: string;
  children: React.ReactNode;
}) {
  const state = useListToolbarButtonState({ nodeType: listStyleType });
  const { props } = useListToolbarButton(state);
  return (
    <button
      type="button"
      title={title}
      className={TOOLBAR_BTN_CLASS}
      {...props}
    >
      {children}
    </button>
  );
}

function EmailToolbar() {
  return (
    <div className="flex items-center gap-0.5 border-b bg-muted/30 px-2 py-1">
      <MarkBtn markKey="bold" title="Bold">
        <BoldIcon className="h-3.5 w-3.5" />
      </MarkBtn>
      <MarkBtn markKey="italic" title="Italic">
        <ItalicIcon className="h-3.5 w-3.5" />
      </MarkBtn>
      <MarkBtn markKey="underline" title="Underline">
        <UnderlineIcon className="h-3.5 w-3.5" />
      </MarkBtn>
      <div className="mx-1 h-4 w-px bg-border" />
      <ListBtn listStyleType={ListStyleType.Disc} title="Bullet list">
        <ListIcon className="h-3.5 w-3.5" />
      </ListBtn>
      <ListBtn listStyleType={ListStyleType.Decimal} title="Numbered list">
        <ListOrderedIcon className="h-3.5 w-3.5" />
      </ListBtn>
    </div>
  );
}

// ─── Email editor inner (must be inside <Plate> context) ─────────────────────

function EmailEditorInner({
  onSubmit,
  isPending,
}: {
  onSubmit: () => void;
  isPending: boolean;
}) {
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <>
      <EmailToolbar />
      <PlateContent
        className="min-h-[100px] max-h-[240px] overflow-y-auto px-3 py-2 text-sm outline-none"
        placeholder="Write email body…"
        onKeyDown={handleKeyDown}
        disabled={isPending}
      />
    </>
  );
}

// ─── Quote chip ───────────────────────────────────────────────────────────────

function QuoteChip({
  replyTo,
  onClear,
}: {
  replyTo: ReplyToMessage;
  onClear?: () => void;
}) {
  const preview =
    replyTo.contentPreview.length > 60
      ? `${replyTo.contentPreview.slice(0, 60)}…`
      : replyTo.contentPreview;

  return (
    <div className="mb-2 flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-xs">
      <MessageSquareIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">Replying to</span>
      <span className="font-medium text-foreground">{replyTo.senderName}</span>
      <span className="text-muted-foreground">:</span>
      <span className="flex-1 truncate text-muted-foreground">{preview}</span>
      <button
        type="button"
        aria-label="Clear reply"
        onClick={onClear}
        className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <XIcon className="h-3 w-3" />
      </button>
    </div>
  );
}

// ─── Kbd hint ─────────────────────────────────────────────────────────────────

function KbdHint() {
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad/.test(navigator.userAgent);
  return (
    <span className="text-xs text-muted-foreground">
      <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-xs">
        {isMac ? '⌘' : 'Ctrl'}+Enter
      </kbd>{' '}
      to send
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export const BlockReplyInput = memo(function BlockReplyInput(
  props: BlockReplyInputProps,
) {
  if (props.channelType === 'email') {
    return <EmailReplyInput {...props} />;
  }
  return <StandardReplyInput {...props} />;
});

// ─── Email reply (Plate editor) ───────────────────────────────────────────────

const EmailReplyInput = memo(function EmailReplyInput({
  conversationTitle,
  replyToMessage,
  onClearReplyTo,
  onSend,
  isPending = false,
  error,
}: BlockReplyInputProps) {
  const [subject, setSubject] = useState(conversationTitle ?? '');
  const [cc, setCc] = useState('');
  const [replyAll, setReplyAll] = useState(false);

  const emailEditor = usePlateEditor({
    plugins: emailEditorPlugins,
    override: { components: emailEditorComponents },
  });

  function handleSendEmail() {
    const body = JSON.stringify(emailEditor.children);
    onSend(body, false, replyToMessage?.messageId, {
      subject: subject.trim() || undefined,
      cc: cc
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      replyAll,
    });
    emailEditor.tf.setValue([{ type: 'p', children: [{ text: '' }] }]);
  }

  return (
    <div className="border-t bg-background px-4 py-3">
      {replyToMessage && (
        <QuoteChip replyTo={replyToMessage} onClear={onClearReplyTo} />
      )}

      <div className="flex flex-col gap-2">
        {/* Subject */}
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-xs text-muted-foreground">
            Subject
          </span>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="(no subject)"
            className="h-7 text-sm"
            disabled={isPending}
          />
        </div>

        {/* CC */}
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-xs text-muted-foreground">
            CC
          </span>
          <Input
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            placeholder="Comma-separated addresses"
            className="h-7 text-sm"
            disabled={isPending}
          />
        </div>

        {/* Rich text body */}
        <div className="overflow-hidden rounded-md border bg-background">
          <Plate editor={emailEditor}>
            <EmailEditorInner
              onSubmit={handleSendEmail}
              isPending={isPending}
            />
          </Plate>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <KbdHint />
            <button
              type="button"
              onClick={() => setReplyAll((r) => !r)}
              className={cn(
                'rounded px-1.5 py-0.5 text-xs font-medium transition-colors',
                replyAll
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {replyAll ? 'Reply All' : 'Reply'}
            </button>
          </div>
          <Button
            size="sm"
            className="h-7 gap-1.5 px-3"
            disabled={isPending}
            onClick={handleSendEmail}
          >
            <SendIcon className="h-3.5 w-3.5" />
            Send
          </Button>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
});

// ─── Standard reply (textarea) ────────────────────────────────────────────────

const StandardReplyInput = memo(function StandardReplyInput({
  replyToMessage,
  onClearReplyTo,
  onSend,
  isPending = false,
  error,
  initialContent,
}: BlockReplyInputProps) {
  const [content, setContent] = useState(initialContent ?? '');
  const [isInternal, setIsInternal] = useState(false);

  function handleSend() {
    const trimmed = content.trim();
    if (!trimmed || isPending) return;
    onSend(trimmed, isInternal, replyToMessage?.messageId ?? undefined);
    setContent('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div
      className={cn(
        'bg-background',
        isInternal && 'bg-violet-50/30 dark:bg-violet-950/10',
      )}
    >
      {replyToMessage && (
        <QuoteChip replyTo={replyToMessage} onClear={onClearReplyTo} />
      )}

      <div className="flex items-end gap-2">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isInternal ? 'Write an internal note…' : 'Reply…'}
          className={cn(
            'min-h-[56px] max-h-[120px] resize-none text-sm',
            isInternal &&
              'border-violet-300 bg-violet-50/30 dark:border-violet-800 dark:bg-violet-950/20',
          )}
          rows={2}
          disabled={isPending}
        />
        <Button
          size="sm"
          className="h-8 shrink-0 gap-1.5 px-3"
          disabled={!content.trim() || isPending}
          onClick={handleSend}
        >
          <SendIcon className="h-3.5 w-3.5" />
          {isInternal ? 'Note' : 'Send'}
        </Button>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <KbdHint />
          <button
            type="button"
            onClick={() => setIsInternal((i) => !i)}
            className={cn(
              'text-xs font-medium transition-colors',
              isInternal
                ? 'text-violet-600 dark:text-violet-400'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {isInternal ? 'Switch to reply' : 'Internal note'}
          </button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
});
