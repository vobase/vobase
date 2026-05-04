/**
 * InstanceDoctorButton — triggers a channel health-check via
 * POST /api/channels/:instanceId/doctor and renders results in a Sheet.
 */

import { useMutation } from '@tanstack/react-query'
import { Stethoscope } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Status } from '@/components/ui/status'
import { channelsClient } from '@/lib/api-client'

interface DoctorCheck {
  id: string
  label: string
  status: 'green' | 'amber' | 'red'
  detail: string
}

interface DoctorResult {
  instanceId: string
  channel: string
  checks: DoctorCheck[]
}

type CheckStatus = 'green' | 'amber' | 'red'

function checkToVariant(s: CheckStatus) {
  if (s === 'green') return 'success' as const
  if (s === 'amber') return 'warning' as const
  return 'error' as const
}

export function InstanceDoctorButton({ instanceId, displayName }: { instanceId: string; displayName?: string | null }) {
  const [open, setOpen] = useState(false)

  const { mutate, data, isPending, error } = useMutation({
    mutationFn: async (): Promise<DoctorResult> => {
      const r = await channelsClient.instances[':id'].doctor.$post({ param: { id: instanceId } })
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `doctor failed: ${r.status}`)
      }
      return (await r.json()) as DoctorResult
    },
  })

  function handleOpen() {
    setOpen(true)
    mutate()
  }

  const allGreen = data ? data.checks.every((c) => c.status === 'green') : false
  const anyRed = data ? data.checks.some((c) => c.status === 'red') : false

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleOpen} className="gap-1.5">
        <Stethoscope className="size-3.5" />
        Doctor
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-[440px] sm:max-w-[440px]">
          <SheetHeader>
            <SheetTitle>Channel health check</SheetTitle>
            <SheetDescription>{displayName ?? instanceId}</SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-3">
            {isPending && (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
                ))}
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm">
                {error instanceof Error ? error.message : 'Doctor check failed'}
              </div>
            )}

            {data && (
              <>
                <div className="mb-4 flex items-center gap-2 text-muted-foreground text-sm">
                  {allGreen && <Status variant="success" label="All checks passed" />}
                  {!allGreen && anyRed && <Status variant="error" label="Issues detected" />}
                  {!allGreen && !anyRed && <Status variant="warning" label="Some checks need attention" />}
                </div>

                {data.checks.map((check) => (
                  <div key={check.id} className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{check.label}</span>
                      <Status variant={checkToVariant(check.status)} label={check.status} />
                    </div>
                    <p className="text-muted-foreground text-xs">{check.detail}</p>
                  </div>
                ))}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
