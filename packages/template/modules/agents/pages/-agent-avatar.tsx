import { BotIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

interface AgentAvatarProps {
  size?: 'sm' | 'md'
  className?: string
}

export function AgentAvatar({ size = 'md', className }: AgentAvatarProps) {
  const box = size === 'sm' ? 'size-8' : 'size-10'
  const icon = size === 'sm' ? 'size-4' : 'size-5'
  return (
    <div
      className={cn('flex items-center justify-center rounded-lg shrink-0 bg-primary/15 text-primary', box, className)}
    >
      <BotIcon className={icon} />
    </div>
  )
}
