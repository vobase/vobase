import type { HeadlineParts } from '@modules/changes/lib/humanize'

import { Principal, type PrincipalDirectory } from '@/components/principal'

/**
 * Renders the resource portion of a change-proposal headline. Memory edits
 * collapse to "<owner>'s Memory", contact edits to just the contact's name,
 * drive docs to "Document: <basename>". Owner avatar is always shown for
 * owned resources. Shared between proposal-row (collapsed details disclosure)
 * and history-row (always-visible header).
 */
export function HeadlineTarget({ parts, directory }: { parts: HeadlineParts; directory: PrincipalDirectory }) {
  if (parts.kind === 'principal') {
    return <Principal id={parts.principalToken} variant="inline" directory={directory} className="text-foreground" />
  }
  if (parts.kind === 'owned-resource') {
    return (
      <>
        <Principal id={parts.ownerToken} variant="inline" directory={directory} className="text-foreground" />
        <span className="text-muted-foreground">{"'s"}</span>
        <span className="font-semibold">{parts.ownerLabel}</span>
        {parts.resourceName && (
          <>
            <span className="text-muted-foreground">:</span>
            <span className="font-mono text-foreground/90 text-sm">{parts.resourceName}</span>
          </>
        )}
      </>
    )
  }
  return (
    <>
      <span className="font-semibold">{parts.kindLabel}:</span>
      <span className="font-mono text-foreground/90 text-sm">{parts.resourceName}</span>
    </>
  )
}
