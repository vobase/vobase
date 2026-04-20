import { useState } from 'react'
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useKeyboardNav } from '@/hooks/use-keyboard-nav'
import { useSendNote } from './api/use-send-note'
import { useStaffReply } from './api/use-staff-reply'

interface ComposerProps {
  conversationId: string
}

type Mode = 'reply' | 'note'

export function Composer({ conversationId }: ComposerProps) {
  const [mode, setMode] = useState<Mode>('reply')
  const [text, setText] = useState('')
  const isEmpty = !text.trim()

  const staffReply = useStaffReply(conversationId)
  const sendNote = useSendNote(conversationId)

  const submit = () => {
    if (isEmpty) return
    const trimmed = text.trim()
    if (mode === 'reply') {
      staffReply.mutate(trimmed, { onSuccess: () => setText('') })
    } else {
      sendNote.mutate(trimmed, { onSuccess: () => setText('') })
    }
  }

  useKeyboardNav({ context: 'inbox-detail', onSubmitComposer: submit })

  const isPending = mode === 'reply' ? staffReply.isPending : sendNote.isPending

  return (
    <div className="shrink-0">
      <div className="flex items-center gap-2 px-3 pt-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={mode}
          onValueChange={(v) => {
            if (v) setMode(v as Mode)
          }}
        >
          <ToggleGroupItem value="reply" size="sm">
            Reply
          </ToggleGroupItem>
          <ToggleGroupItem value="note" size="sm">
            Note
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <PromptInput
        onSubmit={(msg) => {
          if (!msg.text.trim()) return
          const trimmed = msg.text.trim()
          if (mode === 'reply') {
            staffReply.mutate(trimmed, { onSuccess: () => setText('') })
          } else {
            sendNote.mutate(trimmed, { onSuccess: () => setText('') })
          }
        }}
      >
        <PromptInputTextarea
          placeholder={mode === 'reply' ? 'Reply to customer…' : 'Internal note (visible to staff only)'}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              if (!isEmpty) e.currentTarget.form?.requestSubmit()
            }
          }}
        />
        <PromptInputFooter className="justify-end">
          <PromptInputSubmit disabled={isEmpty || isPending} />
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}
