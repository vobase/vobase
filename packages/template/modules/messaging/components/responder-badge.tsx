import { Principal } from '@/components/principal'
import { Button } from '@/components/ui/button'
import { PrincipalAvatar, usePrincipalDirectory } from './principal'

/**
 * Compact, read-only display of the conversation's responder (`assignee`) — the
 * agent or human currently replying — with a single button to flip it. This is
 * NOT a people picker: who replies is a mode (AI ↔ human), not an assignment.
 * The owner (staff in charge) is managed separately by `OwnerBadge`.
 */
export function ResponderBadge({
  assignee,
  currentUserId,
  disabled,
  onReassign,
}: {
  assignee: string | null
  currentUserId: string | null
  disabled?: boolean
  onReassign: (assignee: string) => void
}) {
  const { resolve, agents } = usePrincipalDirectory()
  const current = resolve(assignee)
  // `assignee` is the `agent:<id>` | `user:<id>` discriminated token — prefix is
  // how it is classified, independent of whether the principal directory has
  // the row.
  const isAgent = (assignee ?? '').startsWith('agent:')
  return (
    <div className="flex items-center gap-1.5">
      <span className="sr-only text-muted-foreground text-xs sm:not-sr-only">Replying</span>
      {current ? (
        <span className="inline-flex items-center gap-1.5">
          <PrincipalAvatar kind={current.kind} />
          <Principal id={current.token} variant="simple" noHover className="font-medium text-sm" />
        </span>
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      )}
      {isAgent ? (
        currentUserId ? (
          <Button
            size="sm"
            variant="outline"
            className="ml-2"
            disabled={disabled}
            onClick={() => onReassign(`user:${currentUserId}`)}
          >
            Take over
          </Button>
        ) : null
      ) : agents.length > 0 ? (
        <Button
          size="sm"
          variant="outline"
          className="ml-2"
          disabled={disabled}
          onClick={() => onReassign(`agent:${agents[0].id}`)}
        >
          Return to AI
        </Button>
      ) : null}
    </div>
  )
}
