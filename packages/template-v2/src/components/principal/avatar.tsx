/**
 * Kind-tinted avatar for principals. Purple = agent, blue = staff,
 * green = contact (cultural convention; mirrored in the mention pill and
 * inbox subtitle elsewhere in this folder).
 */

import { BotIcon, UserIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { PrincipalKind } from './directory'

const AVATAR_SIZE: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'size-5',
  md: 'size-6',
  lg: 'size-9',
}

const ICON_SIZE: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'size-3',
  md: 'size-3.5',
  lg: 'size-5',
}

const RING: Record<PrincipalKind, string> = {
  agent: 'bg-violet-500/15 text-violet-600 dark:text-violet-300',
  staff: 'bg-blue-500/15 text-blue-600 dark:text-blue-300',
  contact: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
}

export function PrincipalAvatar({
  kind,
  size = 'sm',
  className,
}: {
  kind: PrincipalKind
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const Icon = kind === 'agent' ? BotIcon : UserIcon
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        AVATAR_SIZE[size],
        RING[kind],
        className,
      )}
      aria-hidden
    >
      <Icon className={ICON_SIZE[size]} />
    </span>
  )
}
