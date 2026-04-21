import { Conversation, ConversationContent } from '@/components/ai-elements/conversation'
import { Message as AiMessage, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Task, TaskContent, TaskItem, TaskTrigger } from '@/components/ai-elements/task'
import { MessageCard } from '@/components/message-card'
import type { Message, MessageRole } from '../schema'

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
}

export function MessageThread({ messages }: MessageThreadProps) {
  // Card action buttons are rendered by `MessageCard` (via `CardActions`), which POSTs
  // the customer's selection and writes a `card_reply` back into the thread. We used
  // to also render an ai-elements `<Suggestions>` chip row below every card from the
  // same action list, producing a duplicate button group in the UI.
  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent>
        {messages.map((msg) => {
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
                      {taskPayload.items.map((item) => (
                        <TaskItem key={item.id}>{item.label}</TaskItem>
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
