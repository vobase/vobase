/**
 * Compatibility shim — the canonical principal primitive lives at
 * `@/components/principal`. New call sites should import from there directly.
 * This file re-exports the same symbols so existing imports under
 * `@modules/messaging/components/principal` keep working.
 */

import type React from 'react'

import { PrincipalAvatar, Principal as PrincipalComponent, type PrincipalRecord } from '@/components/principal'
import { cn } from '@/lib/utils'

export {
  PrincipalAvatar,
  type PrincipalDirectory,
  type PrincipalKind,
  type PrincipalRecord,
  usePrincipalDirectory,
} from '@/components/principal'

/** @deprecated Use `<Principal id={record.token} variant="inbox" />`. */
export function PrincipalChip({
  principal,
  size: _size,
  className,
}: {
  principal: PrincipalRecord
  size?: 'sm' | 'md'
  className?: string
}): React.ReactElement {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <PrincipalAvatar kind={principal.kind} size="sm" />
      <PrincipalComponent id={principal.token} variant="simple" noHover className="font-medium" />
    </span>
  )
}
