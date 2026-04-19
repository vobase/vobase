import type { Message, MessageRole } from '@server/contracts/domain-types'
import { Conversation, ConversationContent } from '@/components/ai-elements/conversation'
import { Message as AiMessage, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion'
import { Task, TaskContent, TaskItem, TaskTrigger } from '@/components/ai-elements/task'
import type { ButtonElement } from '@/components/card-actions'
import { postCardReply } from '@/components/card-actions'
import { MessageCard } from '@/components/message-card'

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

interface CardAction {
  id: string
  label: string
  value: string
}

function extractActions(msg: DisplayMessage): CardAction[] {
  if (msg.role !== 'agent' || msg.kind !== 'card') return []
  type CardContent = {
    card?: { children?: Array<{ type: string; buttons?: ButtonElement[] }> }
  }
  const card = (msg.content as CardContent)?.card
  if (!card?.children) return []
  return card.children
    .filter((c) => c.type === 'actions')
    .flatMap((c) => (c.buttons ?? []).map((b) => ({ id: b.id, label: b.label, value: b.value })))
}

interface MessageThreadProps {
  messages: DisplayMessage[]
}

export function MessageThread({ messages }: MessageThreadProps) {
  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent>
        {messages.map((msg) => {
          const actions = extractActions(msg)
          const taskPayload = isTaskPayload(msg.content) ? msg.content : null
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
                      <MessageCard message={msg} />
                    )}
                  </MessageContent>
                )}
              </AiMessage>
              {actions.length > 0 && (
                <Suggestions>
                  {actions.map((action) => (
                    <Suggestion
                      key={action.id}
                      suggestion={action.label}
                      onClick={() =>
                        postCardReply({
                          messageId: msg.id,
                          buttonId: action.id,
                          buttonValue: action.value,
                        }).catch(() => undefined)
                      }
                    />
                  ))}
                </Suggestions>
              )}
            </div>
          )
        })}
      </ConversationContent>
    </Conversation>
  )
}
