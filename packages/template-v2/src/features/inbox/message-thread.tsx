import type { Message, MessageRole } from '@server/contracts/domain-types'
import { Conversation, ConversationContent } from '@/components/ai-elements/conversation'
import { Message as AiMessage, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion'
import type { ButtonElement } from '@/components/card-actions'
import { postCardReply } from '@/components/card-actions'
import { MessageCard } from '@/components/message-card'

type UiRole = 'user' | 'assistant' | 'system'

function toUiRole(role: MessageRole): UiRole {
  if (role === 'customer') return 'user'
  if (role === 'agent') return 'assistant'
  return 'system'
}

interface CardAction {
  id: string
  label: string
  value: string
}

function extractActions(msg: Message): CardAction[] {
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
  messages: Message[]
}

export function MessageThread({ messages }: MessageThreadProps) {
  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent>
        {messages.map((msg) => {
          const actions = extractActions(msg)
          return (
            <div key={msg.id} className="flex flex-col gap-2">
              <AiMessage from={toUiRole(msg.role)}>
                <MessageContent>
                  {msg.kind === 'text' ? (
                    <MessageResponse>{String((msg.content as { text?: unknown })?.text ?? '')}</MessageResponse>
                  ) : (
                    <MessageCard message={msg} />
                  )}
                </MessageContent>
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
