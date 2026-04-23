import { useSendNote } from '@modules/messaging/api/use-send-note'
import { useStaffReply } from '@modules/messaging/api/use-staff-reply'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useKeyboardNav } from '@/hooks/use-keyboard-nav'
import { cn } from '@/lib/utils'
import { NoteEditor, type NoteEditorHandle } from './note-editor'

interface ComposerProps {
  conversationId: string
}

type Mode = 'reply' | 'note'

export function Composer({ conversationId }: ComposerProps) {
  const [mode, setMode] = useState<Mode>('reply')
  const [text, setText] = useState('')
  const noteRef = useRef<NoteEditorHandle>(null)
  const [noteEmpty, setNoteEmpty] = useState(true)

  const staffReply = useStaffReply(conversationId)
  const sendNote = useSendNote(conversationId)

  const isEmptyReply = !text.trim()

  const submit = () => {
    if (mode === 'reply') {
      if (isEmptyReply) return
      staffReply.mutate(text.trim(), { onSuccess: () => setText('') })
    } else {
      const { body, mentions } = noteRef.current?.getValue() ?? { body: '', mentions: [] }
      if (!body) return
      sendNote.mutate(
        { body, mentions },
        {
          onSuccess: () => {
            noteRef.current?.reset()
            setNoteEmpty(true)
          },
        },
      )
    }
  }

  useKeyboardNav({ context: 'messaging-detail', onSubmitComposer: submit })

  const isPending = mode === 'reply' ? staffReply.isPending : sendNote.isPending
  const isEmpty = mode === 'reply' ? isEmptyReply : noteEmpty

  const textareaClass = cn(
    'block h-[76px] max-h-48 w-full resize-none rounded-none border-0 bg-transparent px-3 py-2 text-sm leading-5 shadow-none',
    'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0',
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  const tabClass = (active: boolean) =>
    cn(
      'rounded-md px-2 py-1 text-xs font-medium transition-colors',
      active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
    )

  return (
    <div className="shrink-0 px-3 pb-3">
      <div className="rounded-md border border-input bg-transparent shadow-xs focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/50">
        <div className="flex items-center gap-1 px-2 pt-2">
          <button type="button" className={tabClass(mode === 'reply')} onClick={() => setMode('reply')}>
            Reply
          </button>
          <button type="button" className={tabClass(mode === 'note')} onClick={() => setMode('note')}>
            Note
          </button>
        </div>
        {mode === 'reply' ? (
          <textarea
            placeholder="Reply to customer…"
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={onKeyDown}
            className={textareaClass}
          />
        ) : (
          <NoteEditor
            handleRef={noteRef}
            placeholder="Internal note — type @ to mention staff or agents…"
            onEmptyChange={setNoteEmpty}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
            }}
          />
        )}
        <div className="flex items-center justify-end px-2 pb-2">
          <Button size="sm" type="button" disabled={isEmpty || isPending} onClick={submit}>
            {mode === 'reply' ? 'Send reply' : 'Send note'}
          </Button>
        </div>
      </div>
    </div>
  )
}
