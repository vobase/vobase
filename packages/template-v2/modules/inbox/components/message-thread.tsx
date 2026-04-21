import { StickyNote } from 'lucide-react'
import { Conversation, ConversationContent } from '@/components/ai-elements/conversation'
import { Message as AiMessage, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Task, TaskContent, TaskItem, TaskTrigger } from '@/components/ai-elements/task'
import { MessageCard } from '@/components/message-card'
import type { InternalNote, Message, MessageRole } from '../schema'

type UiRole = 'user' | 'assistant' | 'system'

function toUiRole(role: MessageRole): UiRole {
  if (role === 'customer') return 'user'
  if (role === 'agent') return 'assistant'
  return 'system'
}

export type DisplayMessage = Message & { reasoning?: string | null }

interface TaskPayload {
  type: 'task'
  title: string
  items: Array<{ id: string; label: string }>
}

function isTaskPayload(content: unknown): content is TaskPayload {
  if (typeof content !== 'object' || content === null) return false
  const c = content as Record<string, unknown>
  return c.type === 'task' && typeof c.title === 'string' && Array.isArray(c.items)
}

interface MessageThreadProps {
  messages: DisplayMessage[]
  notes?: InternalNote[]
}

type TimelineItem = { kind: 'message'; at: Date; msg: DisplayMessage } | { kind: 'note'; at: Date; note: InternalNote }

export function MessageThread({ messages, notes = [] }: MessageThreadProps) {
  const items: TimelineItem[] = [
    ...messages.map((m) => ({ kind: 'message' as const, at: new Date(m.createdAt), msg: m })),
    ...notes.map((n) => ({ kind: 'note' as const, at: new Date(n.createdAt), note: n })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime())
  // Card action buttons are rendered by `MessageCard` (via `CardActions`), which POSTs
  // the customer's selection and writes a `card_reply` back into the thread. We used
  // to also render an ai-elements `<Suggestions>` chip row below every card from the
  // same action list, producing a duplicate button group in the UI.
  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent>
        {items.map((item) => {
          if (item.kind === 'note') {
            return <NoteRow key={`note-${item.note.id}`} note={item.note} />
          }
          const msg = item.msg
          const taskPayload = isTaskPayload(msg.content) ? msg.content : null
          // Find the parent card message for a card_reply (so the reply bubble can
          // show an inline "↳ <parent card title>" hint).
          const parent = msg.kind === 'card_reply' ? messages.find((m) => m.id === msg.parentMessageId) : undefined
          return (
            <div key={msg.id} className="flex flex-col gap-2">
              <AiMessage from={toUiRole(msg.role)}>
                {msg.reasoning && (
                  <Reasoning defaultOpen={false}>
                    <ReasoningTrigger />
                    <ReasoningContent>{msg.reasoning}</ReasoningContent>
                  </Reasoning>
                )}
                {taskPayload ? (
                  <Task>
                    <TaskTrigger title={taskPayload.title} />
                    <TaskContent>
                      {taskPayload.items.map((task) => (
                        <TaskItem key={task.id}>{task.label}</TaskItem>
                      ))}
                    </TaskContent>
                  </Task>
                ) : (
                  <MessageContent>
                    {msg.kind === 'text' ? (
                      <MessageResponse>{String((msg.content as { text?: unknown })?.text ?? '')}</MessageResponse>
                    ) : (
                      <MessageCard message={msg} parentMessage={parent} />
                    )}
                  </MessageContent>
                )}
              </AiMessage>
            </div>
          )
        })}
      </ConversationContent>
    </Conversation>
  )
}

function NoteRow({ note }: { note: InternalNote }) {
  const author = note.authorType === 'staff' ? note.authorId : note.authorType
  return (
    <div className="flex justify-center px-2 py-1">
      <div className="w-full max-w-[80%] rounded-md border border-amber-500/30 bg-amber-50/60 px-3 py-2 text-sm dark:bg-amber-950/20">
        <div className="mb-1 flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-300">
          <StickyNote className="size-3.5" />
          <span>Internal note</span>
          <span className="text-muted-foreground">· {author}</span>
        </div>
        <p className="whitespace-pre-wrap text-foreground">{note.body}</p>
      </div>
    </div>
  )
}
