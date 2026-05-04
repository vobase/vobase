import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Status } from '@/components/ui/status'
import type { DoctorCheck, DoctorResult } from '../hooks/use-instance-doctor'
import { useInstanceDoctor } from '../hooks/use-instance-doctor'

type CheckStatus = DoctorCheck['status']

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

function DoctorChecks({ data }: { data: DoctorResult }) {
  const summary = summariseChecks(data.checks)
  return (
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
  )
}

interface InstanceDoctorSheetProps {
  instanceId: string
  displayName?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function InstanceDoctorSheet({ instanceId, displayName, open, onOpenChange }: InstanceDoctorSheetProps) {
  const { run, data, isPending, error } = useInstanceDoctor(instanceId)

  function handleOpenChange(next: boolean) {
    if (next) run()
    onOpenChange(next)
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
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

          {data && <DoctorChecks data={data} />}
        </div>
      </SheetContent>
    </Sheet>
  )
}
