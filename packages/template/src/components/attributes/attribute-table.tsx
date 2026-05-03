import { Link } from '@tanstack/react-router'
import { Settings2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  type AttributeDefinitionLike,
  AttributeFieldControl,
  type AttributeValue,
} from '@/components/attributes/attribute-field-control'
import { InfoCard, InfoRow } from '@/components/info'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

interface AttributeMutation {
  mutateAsync: (patch: Record<string, AttributeValue>) => Promise<unknown>
  isPending: boolean
}

interface Props<TDef extends AttributeDefinitionLike & { id: string }> {
  defs: TDef[] | undefined
  isLoading: boolean
  values: Record<string, AttributeValue>
  mutation: AttributeMutation
  idPrefix: string
  manageHref: string
  emptyTitle: string
  emptyDescription: string
}

export function AttributeTable<TDef extends AttributeDefinitionLike & { id: string }>({
  defs,
  isLoading,
  values,
  mutation,
  idPrefix,
  manageHref,
  emptyTitle,
  emptyDescription,
}: Props<TDef>) {
  const [draft, setDraft] = useState<Record<string, AttributeValue>>(values)
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(() => new Set())
  const dirtyRef = useRef(dirtyKeys)
  dirtyRef.current = dirtyKeys

  useEffect(() => {
    setDraft((prev) => {
      const dirty = dirtyRef.current
      if (dirty.size === 0) return values
      const merged: Record<string, AttributeValue> = { ...values }
      for (const k of dirty) {
        if (k in prev) merged[k] = prev[k]
      }
      return merged
    })
    if (dirtyRef.current.size > 0) {
      setDirtyKeys((prev) => {
        let changed = false
        const next = new Set<string>()
        for (const k of prev) {
          if (k in values) next.add(k)
          else changed = true
        }
        return changed ? next : prev
      })
    }
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
      await mutation.mutateAsync(patch)
      setDirtyKeys(new Set())
      toast.success('Attributes saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    }
  }

  if (isLoading) {
    return <div className="text-muted-foreground text-sm">Loading attributes…</div>
  }

  if (!defs || defs.length === 0) {
    return (
      <Empty>
        <EmptyMedia>
          <Settings2 className="size-5" />
        </EmptyMedia>
        <EmptyTitle>{emptyTitle}</EmptyTitle>
        <EmptyDescription>{emptyDescription}</EmptyDescription>
        <div className="mt-3">
          <Button asChild size="sm" variant="outline">
            <Link to={manageHref}>Manage attributes</Link>
          </Button>
        </div>
      </Empty>
    )
  }

  return (
    <div className="space-y-3">
      <InfoCard>
        {defs.map((def) => (
          <InfoRow key={def.id} label={def.label}>
            <div className="max-w-[280px]">
              <AttributeFieldControl
                def={def}
                value={draft[def.key]}
                onChange={(v) => setField(def.key, v)}
                disabled={mutation.isPending}
                idPrefix={idPrefix}
              />
            </div>
          </InfoRow>
        ))}
      </InfoCard>
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          disabled={dirtyKeys.size === 0 || mutation.isPending}
          onClick={() => {
            void save()
          }}
        >
          {mutation.isPending ? 'Saving…' : dirtyKeys.size > 0 ? `Save (${dirtyKeys.size})` : 'Saved'}
        </Button>
      </div>
    </div>
  )
}
