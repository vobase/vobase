/**
 * AttributeTable — fill-in grid for a staff member's custom attributes.
 * Clone of contacts/components/attribute-table.tsx, rebound to team hooks.
 * Definition management lives on `/team/attributes`.
 */

import { Link } from '@tanstack/react-router'
import { Settings2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { useAttributeDefinitions, useSetStaffAttributes } from '../api/use-attributes'
import type { AttributeValue } from '../schema'
import { AttributeFormField } from './attribute-form-field'

interface Props {
  userId: string
  values: Record<string, AttributeValue>
}

export function AttributeTable({ userId, values }: Props) {
  const { data: defs = [], isLoading } = useAttributeDefinitions()
  const setAttrs = useSetStaffAttributes(userId)
  const [draft, setDraft] = useState<Record<string, AttributeValue>>(values)
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    setDraft(values)
    setDirtyKeys(new Set())
  }, [values])

  function setField(key: string, v: AttributeValue | null) {
    setDraft((prev) => {
      const next = { ...prev }
      if (v === null) delete next[key]
      else next[key] = v
      return next
    })
    setDirtyKeys((prev) => new Set(prev).add(key))
  }

  async function save() {
    if (dirtyKeys.size === 0) return
    const patch: Record<string, AttributeValue> = {}
    for (const k of dirtyKeys) patch[k] = draft[k] ?? null
    try {
      await setAttrs.mutateAsync(patch)
      toast.success('Attributes saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    }
  }

  if (isLoading) {
    return <div className="text-muted-foreground text-sm">Loading attributes…</div>
  }

  if (defs.length === 0) {
    return (
      <Empty>
        <EmptyMedia>
          <Settings2 className="size-5" />
        </EmptyMedia>
        <EmptyTitle>No staff attributes yet</EmptyTitle>
        <EmptyDescription>
          Create shared fields once on the attributes page, then fill them in for every staff member.
        </EmptyDescription>
        <div className="mt-3">
          <Button asChild size="sm" variant="outline">
            <Link to="/team/attributes">Manage attributes</Link>
          </Button>
        </div>
      </Empty>
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-4 gap-y-3">
        {defs.map((def) => (
          <AttributeFormField
            key={def.id}
            def={def}
            value={draft[def.key]}
            onChange={(v) => setField(def.key, v)}
            disabled={setAttrs.isPending}
          />
        ))}
      </div>
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          disabled={dirtyKeys.size === 0 || setAttrs.isPending}
          onClick={() => {
            void save()
          }}
        >
          {setAttrs.isPending ? 'Saving…' : dirtyKeys.size > 0 ? `Save (${dirtyKeys.size})` : 'Saved'}
        </Button>
      </div>
    </div>
  )
}
