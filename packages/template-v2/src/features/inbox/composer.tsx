import { useState } from 'react'
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input'
import { useKeyboardNav } from '@/hooks/use-keyboard-nav'
import { useSendNote } from './api/use-send-note'

interface ComposerProps {
  conversationId: string
}

export function Composer({ conversationId }: ComposerProps) {
  const sendNote = useSendNote(conversationId)
  const [text, setText] = useState('')
  const isEmpty = !text.trim()

  const submitNote = () => {
    if (isEmpty) return
    sendNote.mutate(text.trim(), { onSuccess: () => setText('') })
  }

  useKeyboardNav({ context: 'inbox-detail', onSubmitComposer: submitNote })

  return (
    <div className="shrink-0 border-l-2 border-[var(--color-warning)]">
      <PromptInput
        onSubmit={(msg) => {
          if (!msg.text.trim()) return
          sendNote.mutate(msg.text.trim(), { onSuccess: () => setText('') })
        }}
      >
        <PromptInputTextarea
          placeholder="Internal note (visible to staff only)"
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
          <PromptInputSubmit disabled={isEmpty || sendNote.isPending} />
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}
