import { useAgentDefinitions } from '@modules/agents/api/use-agent-definitions'
import { useSendNote } from '@modules/inbox/api/use-send-note'
import { useStaffReply } from '@modules/inbox/api/use-staff-reply'
import { useStaffList } from '@modules/team/api/use-staff'
import { useMemo, useState } from 'react'
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input'
import { Button } from '@/components/ui/button'
import { Mention, MentionContent, MentionInput, MentionItem, MentionLabel } from '@/components/ui/mention'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useKeyboardNav } from '@/hooks/use-keyboard-nav'
import { cn } from '@/lib/utils'

interface ComposerProps {
  conversationId: string
}

type Mode = 'reply' | 'note'

interface MentionOption {
  value: string
  label: string
  group: 'Staff' | 'Agents'
}

export function Composer({ conversationId }: ComposerProps) {
  const [mode, setMode] = useState<Mode>('reply')
  const [text, setText] = useState('')
  const [noteText, setNoteText] = useState('')
  const [noteMentions, setNoteMentions] = useState<string[]>([])

  const staffReply = useStaffReply(conversationId)
  const sendNote = useSendNote(conversationId)

  const { data: staff = [] } = useStaffList()
  const { data: agents = [] } = useAgentDefinitions()

  const mentionOptions = useMemo<MentionOption[]>(() => {
    const s: MentionOption[] = staff.map((p) => ({
      value: `staff:${p.userId}`,
      label: p.displayName ?? p.userId,
      group: 'Staff' as const,
    }))
    const a: MentionOption[] = agents
      .filter((a) => a.enabled)
      .map((a) => ({ value: `agent:${a.id}`, label: a.name, group: 'Agents' as const }))
    return [...s, ...a]
  }, [staff, agents])

  const staffOptions = mentionOptions.filter((o) => o.group === 'Staff')
  const agentOptions = mentionOptions.filter((o) => o.group === 'Agents')

  const isEmptyReply = !text.trim()
  const isEmptyNote = !noteText.trim()

  const submit = () => {
    if (mode === 'reply') {
      if (isEmptyReply) return
      staffReply.mutate(text.trim(), { onSuccess: () => setText('') })
    } else {
      if (isEmptyNote) return
      sendNote.mutate(
        { body: noteText.trim(), mentions: noteMentions },
        {
          onSuccess: () => {
            setNoteText('')
            setNoteMentions([])
          },
        },
      )
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
      {mode === 'reply' ? (
        <PromptInput
          onSubmit={(msg) => {
            if (!msg.text.trim()) return
            staffReply.mutate(msg.text.trim(), { onSuccess: () => setText('') })
          }}
        >
          <PromptInputTextarea
            placeholder="Reply to customer…"
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                if (!isEmptyReply) e.currentTarget.form?.requestSubmit()
              }
            }}
          />
          <PromptInputFooter className="justify-end">
            <PromptInputSubmit disabled={isEmptyReply || isPending} />
          </PromptInputFooter>
        </PromptInput>
      ) : (
        <div className="px-3 py-2">
          <Mention
            trigger="@"
            value={noteMentions}
            onValueChange={setNoteMentions}
            inputValue={noteText}
            onInputValueChange={setNoteText}
          >
            <MentionInput
              asChild
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
              }}
            >
              <textarea
                placeholder="Internal note — type @ to mention staff or agents…"
                rows={3}
                className={cn(
                  'flex w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs',
                  'placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring',
                )}
              />
            </MentionInput>
            <MentionContent>
              {staffOptions.length > 0 && (
                <>
                  <MentionLabel>Staff</MentionLabel>
                  {staffOptions.map((opt) => (
                    <MentionItem key={opt.value} value={opt.value} label={opt.label}>
                      {opt.label}
                    </MentionItem>
                  ))}
                </>
              )}
              {agentOptions.length > 0 && (
                <>
                  <MentionLabel>Agents</MentionLabel>
                  {agentOptions.map((opt) => (
                    <MentionItem key={opt.value} value={opt.value} label={opt.label}>
                      {opt.label}
                    </MentionItem>
                  ))}
                </>
              )}
            </MentionContent>
          </Mention>
          <div className="mt-2 flex items-center justify-end">
            <Button size="sm" type="button" disabled={isEmptyNote || isPending} onClick={submit}>
              Send note
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
