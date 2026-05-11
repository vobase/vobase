import { useSendNote } from '@modules/messaging/hooks/use-send-note'
import { useStaffReply } from '@modules/messaging/hooks/use-staff-reply'
import { useCallback, useEffect, useRef, useState } from 'react'

import { PromptInput, PromptInputFooter, PromptInputSubmit } from '@/components/ai-elements/prompt-input'
import { usePrincipalDirectory } from '@/components/principal'
import { InputGroupTextarea } from '@/components/ui/input-group'
import { useCurrentUserId } from '@/hooks/use-current-user'
import { useKeyboardNav } from '@/hooks/use-keyboard-nav'
import { messagingClient } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { MentionPopover } from './mention-popover'
import { findMentions } from './mentions'

/**
 * Throttle window for the typing-presence beacon. We re-emit every ~2s while
 * the staff member is actively typing; the public chat treats each event as
 * valid for ~3s, so the indicator stays smooth without flooding pg_notify.
 */
const TYPING_THROTTLE_MS = 2000

interface ComposerProps {
  conversationId: string
}

type Mode = 'reply' | 'note'

export function Composer({ conversationId }: ComposerProps) {
  const [mode, setMode] = useState<Mode>('reply')
  const [replyText, setReplyText] = useState('')
  const [noteText, setNoteText] = useState('')

  const replyRef = useRef<HTMLTextAreaElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const directory = usePrincipalDirectory()
  const currentUserId = useCurrentUserId()

  const staffReply = useStaffReply(conversationId)
  const sendNote = useSendNote(conversationId, currentUserId)

  // Throttled typing-presence beacon. Fires at most once per
  // TYPING_THROTTLE_MS while the staff member is actively typing in the
  // reply lane (notes are internal-only, no customer-facing indicator).
  // Failures are non-fatal — typing presence is a UX nicety, not journaled.
  const lastTypingEmitRef = useRef(0)
  const emitTyping = useCallback(() => {
    const now = Date.now()
    if (now - lastTypingEmitRef.current < TYPING_THROTTLE_MS) return
    lastTypingEmitRef.current = now
    void messagingClient.conversations[':id'].typing.$post({ param: { id: conversationId } }).catch(() => undefined)
  }, [conversationId])

  useEffect(() => {
    if (mode === 'reply') replyRef.current?.focus()
    else noteRef.current?.focus()
  }, [mode])

  const handleReplySubmit = ({ text }: { text: string }) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setReplyText('')
    staffReply.mutate(trimmed, {
      onSuccess: () => replyRef.current?.focus(),
      onError: () => setReplyText(trimmed),
    })
  }

  const handleNoteSubmit = ({ text }: { text: string }) => {
    const body = text.trim()
    if (!body) return
    const tokens = Array.from(
      new Set(findMentions(body, [...directory.agents, ...directory.staff]).map((m) => m.record.token)),
    )
    setNoteText('')
    sendNote.mutate(
      { body, mentions: tokens },
      {
        onSuccess: () => noteRef.current?.focus(),
        onError: () => setNoteText(body),
      },
    )
  }

  useKeyboardNav({
    context: 'messaging-detail',
    onSubmitComposer: () => {
      if (mode === 'reply') handleReplySubmit({ text: replyText })
      else handleNoteSubmit({ text: noteText })
    },
  })

  // Plain Tab toggles modes. Tab is captured by the mention popover when open
  // (it stopPropagation), so this only fires when typing in the body.
  const onTabKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      setMode((m) => (m === 'reply' ? 'note' : 'reply'))
    }
  }

  const tabClass = (active: boolean) =>
    cn(
      'rounded-md px-2 py-1 font-medium text-xs transition-colors',
      active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
    )

  const isReply = mode === 'reply'
  const isPending = isReply ? staffReply.isPending : sendNote.isPending
  const text = isReply ? replyText : noteText
  const setText = isReply ? setReplyText : setNoteText
  const activeRef = isReply ? replyRef : noteRef
  const modKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'

  return (
    <div className="relative shrink-0 px-3 pb-3">
      <PromptInput
        onSubmit={isReply ? handleReplySubmit : handleNoteSubmit}
        className={cn(!isReply && '[&>div]:border-amber-500/30 [&>div]:bg-amber-50/70 dark:[&>div]:bg-amber-950/25')}
      >
        <div data-align="block-start" className="flex items-center gap-1 self-start px-2 pt-2">
          <button type="button" className={tabClass(isReply)} onClick={() => setMode('reply')}>
            Reply
          </button>
          <button type="button" className={tabClass(!isReply)} onClick={() => setMode('note')}>
            Note
          </button>
        </div>

        <InputGroupTextarea
          ref={activeRef}
          name="message"
          value={text}
          onChange={(e) => {
            setText(e.currentTarget.value)
            if (isReply && e.currentTarget.value.trim().length > 0) emitTyping()
          }}
          onKeyDown={onTabKey}
          placeholder={isReply ? 'Reply to customer…' : 'Internal note — type @ to mention staff or agents…'}
          className="field-sizing-content max-h-48 min-h-10 py-2"
        />

        <PromptInputFooter className="items-end">
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60">
            <kbd className="rounded border bg-muted/50 px-1 font-mono">{modKey}</kbd>
            <span>+</span>
            <kbd className="rounded border bg-muted/50 px-1 font-mono">Enter</kbd>
            <span>to send</span>
          </span>
          <PromptInputSubmit
            status={isPending ? 'submitted' : undefined}
            disabled={!text.trim() || isPending}
            size="sm"
          >
            {isReply ? 'Send reply' : 'Send note'}
          </PromptInputSubmit>
        </PromptInputFooter>
      </PromptInput>

      {!isReply && (
        <MentionPopover
          textareaRef={noteRef}
          value={noteText}
          directory={directory}
          onSelect={({ nextValue, nextCursor }) => {
            setNoteText(nextValue)
            requestAnimationFrame(() => {
              const ta = noteRef.current
              if (!ta) return
              ta.focus()
              ta.setSelectionRange(nextCursor, nextCursor)
            })
          }}
        />
      )}
    </div>
  )
}
