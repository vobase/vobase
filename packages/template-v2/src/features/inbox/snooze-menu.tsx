import { computeSnoozeTarget, SNOOZE_PRESETS, type SnoozePresetId } from '@modules/inbox/lib/snooze-presets'
import { ClockIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'

interface SnoozeMenuProps {
  conversationId: string
  onSnoozed?: () => void
  by: string
}

async function postSnooze(id: string, until: Date, by: string, reason?: string): Promise<Response> {
  return fetch(`/api/inbox/conversations/${id}/snooze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ until: until.toISOString(), by, reason }),
  })
}

/**
 * Dropdown with 5 snooze presets + custom. The custom variant opens a native
 * `datetime-local` picker inline. Presets resolve via `computeSnoozeTarget`
 * in the user's local timezone.
 */
export function SnoozeMenu({ conversationId, onSnoozed, by }: SnoozeMenuProps) {
  const [customVisible, setCustomVisible] = useState(false)
  const [customValue, setCustomValue] = useState('')

  async function pick(id: SnoozePresetId) {
    if (id === 'custom') {
      setCustomVisible(true)
      return
    }
    const until = computeSnoozeTarget(id, new Date())
    const r = await postSnooze(conversationId, until, by)
    if (r.ok) onSnoozed?.()
  }

  async function submitCustom() {
    if (!customValue) return
    const until = new Date(customValue)
    if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) return
    const r = await postSnooze(conversationId, until, by)
    if (r.ok) {
      setCustomVisible(false)
      setCustomValue('')
      onSnoozed?.()
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" aria-label="Snooze" data-testid="snooze-menu-trigger">
          <ClockIcon className="size-4" />
          Snooze
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Snooze until…</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SNOOZE_PRESETS.map((p) => (
          <DropdownMenuItem
            key={p.id}
            data-testid={`snooze-preset-${p.id}`}
            onClick={() => {
              void pick(p.id)
            }}
          >
            {p.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="snooze-preset-custom"
          onSelect={(e) => {
            e.preventDefault()
            setCustomVisible(true)
          }}
        >
          Custom…
        </DropdownMenuItem>
        {customVisible && (
          <div className="flex flex-col gap-1 p-2">
            <Input
              type="datetime-local"
              value={customValue}
              onChange={(e) => setCustomValue(e.currentTarget.value)}
              data-testid="snooze-custom-input"
            />
            <Button
              size="sm"
              onClick={() => {
                void submitCustom()
              }}
              data-testid="snooze-custom-submit"
            >
              Snooze
            </Button>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
