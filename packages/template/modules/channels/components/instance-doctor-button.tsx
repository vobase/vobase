/**
 * InstanceDoctorButton — triggers a channel health-check via
 * POST /api/channels/:instanceId/doctor and renders results in a Sheet.
 */

import { useMutation } from '@tanstack/react-query'
import { Stethoscope } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
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

const DOCTOR_SKELETON_KEYS = ['debug-token', 'subscribed-apps', 'templates', 'phone', 'reach'] as const

const STATUS_VARIANT: Record<CheckStatus, 'success' | 'warning' | 'error'> = {
  green: 'success',
  amber: 'warning',
  red: 'error',
}

function summariseChecks(checks: DoctorCheck[]): { variant: 'success' | 'warning' | 'error'; label: string } {
  if (checks.some((c) => c.status === 'red')) return { variant: 'error', label: 'Issues detected' }
  if (checks.every((c) => c.status === 'green')) return { variant: 'success', label: 'All checks passed' }
  return { variant: 'warning', label: 'Some checks need attention' }
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

  const summary = data ? summariseChecks(data.checks) : null

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
                {DOCTOR_SKELETON_KEYS.map((k) => (
                  <Skeleton key={k} className="h-14 rounded-lg" />
                ))}
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm">
                {error instanceof Error ? error.message : 'Doctor check failed'}
              </div>
            )}

            {data && summary && (
              <>
                <div className="mb-4 flex items-center gap-2 text-muted-foreground text-sm">
                  <Status variant={summary.variant} label={summary.label} />
                </div>

                {data.checks.map((check) => (
                  <div key={check.id} className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{check.label}</span>
                      <Status variant={STATUS_VARIANT[check.status]} label={check.status} />
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
