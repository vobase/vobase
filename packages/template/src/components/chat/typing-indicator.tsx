import { BrainIcon } from 'lucide-react'
import { useMemo } from 'react'

import { Shimmer } from '@/components/ai-elements/shimmer'
import { useStaffChatStore } from '@/stores/staff-chat-store'

interface TypingIndicatorProps {
  conversationId: string
  /** For public chat: show "thinking" shimmer when AI is processing */
  isAiThinking?: boolean
  /** Hide typing events from this user (the current staff user) */
  excludeUserId?: string
}

function BouncingDots() {
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="animate-bounce inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60 [animation-delay:0s]" />
      <span className="animate-bounce inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60 [animation-delay:0.2s]" />
      <span className="animate-bounce inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/60 [animation-delay:0.4s]" />
    </span>
  )
}

/**
 * Typing indicator.
 * Public chat: shows shimmer "Thinking..." (ai-elements style) when AI is processing.
 * Staff view: shows "[Name] is typing..." with bouncing dots from SSE-based typing events.
 */
export function TypingIndicator({ conversationId, isAiThinking, excludeUserId }: TypingIndicatorProps) {
  // For public chat, use the ai-elements Shimmer component
  if (isAiThinking) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
        <BrainIcon className="size-4" />
        <Shimmer duration={1}>Thinking...</Shimmer>
      </div>
    )
  }

  // For staff view, use Zustand store for typing users
  return <StaffTypingIndicator conversationId={conversationId} excludeUserId={excludeUserId} />
}

function StaffTypingIndicator({ conversationId, excludeUserId }: { conversationId: string; excludeUserId?: string }) {
  const convMap = useStaffChatStore((s) => s.typingUsers.get(conversationId))

  const names = useMemo(() => {
    if (!convMap) return []
    const now = Date.now()
    const result: string[] = []
    for (const [userId, user] of convMap) {
      if (userId === excludeUserId) continue
      if (user.expiresAt > now) {
        result.push(user.name)
      }
    }
    return result
  }, [convMap, excludeUserId])

  if (names.length === 0) return null

  const label = names.length === 1 ? `${names[0]} is typing...` : `${names.join(', ')} are typing...`

  return (
    <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
      <BouncingDots />
      <span>{label}</span>
    </div>
  )
}
