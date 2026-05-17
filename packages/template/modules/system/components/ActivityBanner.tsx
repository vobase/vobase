/**
 * Top-of-dashboard banner — 5 stat tiles.
 *
 * - Today cost (USD)
 * - Active wakes (live count of harness.active_wakes)
 * - Paused rule count
 * - Budget cap (USD/day) — clickable "not set" CTA when null
 * - % used (today / cap) — only shown when a cap is set
 *
 * Cost rollup polls every 60s + on focus (per acceptance criterion 8).
 */

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Stat, StatDescription, StatLabel, StatValue } from '@/components/ui/stat'
import { useActivityBanner, useSetBudget } from '../hooks/use-activity'

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

export function ActivityBanner() {
  const { data, isLoading } = useActivityBanner()
  const [budgetOpen, setBudgetOpen] = useState(false)

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Stat key={`skeleton-${i.toString()}`}>
            <StatLabel>Loading…</StatLabel>
            <StatValue>—</StatValue>
          </Stat>
        ))}
      </div>
    )
  }

  const capSet = data.budgetCapUsd !== null
  const pctTone = data.percentUsed !== null && data.percentUsed >= 100 ? 'text-destructive' : 'text-foreground'

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat>
          <StatLabel>Today cost</StatLabel>
          <StatValue>{fmtUsd(data.todayCostUsd)}</StatValue>
          <StatDescription>LLM spend across all wakes</StatDescription>
        </Stat>

        <Stat>
          <StatLabel>Active wakes</StatLabel>
          <StatValue>{data.activeWakes}</StatValue>
          <StatDescription>In-flight harness rows</StatDescription>
        </Stat>

        <Stat>
          <StatLabel>Paused rules</StatLabel>
          <StatValue>{data.pausedRules}</StatValue>
          <StatDescription>Automations silenced</StatDescription>
        </Stat>

        <Stat>
          <StatLabel>Budget cap</StatLabel>
          <StatValue>
            {capSet ? (
              <span className="flex items-baseline gap-2">
                {fmtUsd(data.budgetCapUsd ?? 0)}
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 font-normal text-muted-foreground text-xs"
                  onClick={() => setBudgetOpen(true)}
                >
                  edit
                </Button>
              </span>
            ) : (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-base"
                onClick={() => setBudgetOpen(true)}
              >
                not set — click to configure
              </Button>
            )}
          </StatValue>
          <StatDescription>Daily LLM spend ceiling</StatDescription>
        </Stat>

        <Stat>
          <StatLabel>% used</StatLabel>
          <StatValue>
            <span className={pctTone}>{data.percentUsed !== null ? `${data.percentUsed.toFixed(1)}%` : '—'}</span>
          </StatValue>
          <StatDescription>{capSet ? 'Today / cap' : 'Set a cap to enable'}</StatDescription>
        </Stat>
      </div>

      <BudgetDialog open={budgetOpen} onOpenChange={setBudgetOpen} currentCapUsd={data.budgetCapUsd} />
    </>
  )
}

function BudgetDialog({
  open,
  onOpenChange,
  currentCapUsd,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  currentCapUsd: number | null
}) {
  const setBudget = useSetBudget()
  const [value, setValue] = useState(currentCapUsd?.toString() ?? '')

  function reset() {
    setValue(currentCapUsd?.toString() ?? '')
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) reset()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{currentCapUsd === null ? 'Set budget cap' : 'Edit budget cap'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="budget-cap-usd">Daily cap (USD)</Label>
            <Input
              id="budget-cap-usd"
              type="number"
              min="0"
              step="0.5"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. 5.00"
              autoFocus
            />
            <p className="text-muted-foreground text-xs">
              When daily spend exceeds this, the budget-watcher auto-pauses all rules.
            </p>
          </div>
          {setBudget.isError && (
            <p className="text-destructive text-xs">
              {setBudget.error instanceof Error ? setBudget.error.message : 'Failed to set cap'}
            </p>
          )}
        </div>
        <DialogFooter className="gap-2">
          {currentCapUsd !== null && (
            <Button
              variant="outline"
              onClick={async () => {
                await setBudget.mutateAsync({ capUsd: null })
                onOpenChange(false)
              }}
              disabled={setBudget.isPending}
            >
              Clear cap
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={setBudget.isPending}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              const n = Number(value)
              if (!Number.isFinite(n) || n < 0) return
              await setBudget.mutateAsync({ capUsd: n })
              onOpenChange(false)
            }}
            disabled={setBudget.isPending || value.trim() === ''}
          >
            {setBudget.isPending ? 'Saving…' : 'Save cap'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
