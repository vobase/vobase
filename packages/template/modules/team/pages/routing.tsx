/**
 * `/team/routing` — CRUD over lead-routing rules.
 *
 * Three kinds of rules drive `route_lead`:
 *   - `exclusive`    — keyword → one rep (named account assignment)
 *   - `pool_keyword` — keyword → pool (sector round-robin)
 *   - `pool_member`  — pool → rep (pool membership)
 */

import { createFileRoute, Link } from '@tanstack/react-router'
import { Briefcase, HelpCircle, Layers, Plus, Tag, Trash2, User, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { PageBody, PageHeader, PageLayout } from '@/components/layout/page-layout'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  type UpsertRoutingRuleInput,
  useRemoveRoutingRule,
  useRoutingRules,
  useUpsertRoutingRule,
} from '../hooks/use-routing-rules'
import { useStaffList } from '../hooks/use-staff'
import type { RoutingRule, RoutingRuleKind, StaffProfile } from '../schema'

// ── Small UI helpers ─────────────────────────────────────────────────────────

function PriorityBadge({ value }: { value: number }) {
  // Surface priority so tie-break behaviour (higher wins among same-length
  // keyword matches) is visible at a glance.
  return (
    <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
      p:{value}
    </Badge>
  )
}

// ── Routing explainer ────────────────────────────────────────────────────────

function HowRoutingDecidesCard() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <HelpCircle className="size-4" />
          How routing decides
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>Corporate inquiries walk three steps. The first match wins.</p>
        <ol className="ml-5 list-decimal space-y-1.5">
          <li>
            <strong>Exclusive keyword</strong> — a named-account match (e.g. "acme" → a specific rep). Longest matching
            keyword wins; ties break by higher priority.
          </li>
          <li>
            <strong>Pool keyword</strong> — a sector keyword (e.g. "automobile") points at a pool. The lead goes to the
            least-recently-assigned pool member (skipping <code className="font-mono">off</code>/
            <code className="font-mono">inactive</code>).
          </li>
          <li>
            <strong>Corporate team-lead fallback</strong> — round-robin across staff with both{' '}
            <code className="font-mono">corporate_team</code> and <code className="font-mono">team_lead</code> set.
            Unrouted if none.
          </li>
        </ol>
        <p>
          Private inquiries skip the keyword steps and round-robin across staff with{' '}
          <code className="font-mono">private_team</code> set. If no member is available, falls back to{' '}
          <code className="font-mono">private_team AND team_lead</code>.
        </p>
        <p className="text-muted-foreground text-xs">
          Matching is whole-word against <code className="font-mono">companyName + industry</code>, lowercased. So "gas"
          does not match "Glasgow", but "oil" matches "oil-and-gas".
        </p>
      </CardContent>
    </Card>
  )
}

// ── Attribute-driven team cards ──────────────────────────────────────────────

function TeamMembershipCard({
  title,
  icon,
  attributeKey,
  members,
  emptyHint,
}: {
  title: string
  icon: React.ReactNode
  attributeKey: 'corporate_team' | 'private_team'
  members: StaffProfile[]
  emptyHint: string
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {members.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No staff marked <code className="font-mono">{attributeKey}</code>. {emptyHint}{' '}
            <Link to="/team" className="underline">
              Go to the staff list
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {members.map((s) => (
              <li key={s.userId} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>{s.displayName ?? s.userId}</span>
                {s.attributes?.team_lead === true && <Badge variant="default">Lead</Badge>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ── Delete confirm ────────────────────────────────────────────────────────────

function DeleteRuleConfirm({ target, onClose }: { target: RoutingRule | null; onClose: () => void }) {
  const remove = useRemoveRoutingRule()
  async function confirm() {
    if (!target) return
    try {
      await remove.mutateAsync(target.id)
      toast.success('Rule deleted')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    }
  }
  const label =
    target?.kind === 'exclusive'
      ? `exclusive "${target.keyword}"`
      : target?.kind === 'pool_keyword'
        ? `pool keyword "${target.keyword}" → ${target.pool}`
        : target?.kind === 'pool_member'
          ? `pool member in "${target?.pool}"`
          : 'rule'

  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete {label}?</AlertDialogTitle>
        <AlertDialogDescription>This routing rule will be permanently removed.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          onClick={() => {
            void confirm()
          }}
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          disabled={remove.isPending}
        >
          {remove.isPending ? 'Deleting…' : 'Delete'}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  )
}

// ── New rule dialog ───────────────────────────────────────────────────────────

function NewRuleDialog({
  open,
  onClose,
  existingPools,
}: {
  open: boolean
  onClose: () => void
  existingPools: string[]
}) {
  const { data: staffList = [] } = useStaffList()
  const upsert = useUpsertRoutingRule()

  const [kind, setKind] = useState<RoutingRuleKind>('exclusive')
  const [keyword, setKeyword] = useState('')
  const [pool, setPool] = useState('')
  const [repUserId, setRepUserId] = useState('')
  const [priority, setPriority] = useState('')

  function reset() {
    setKind('exclusive')
    setKeyword('')
    setPool('')
    setRepUserId('')
    setPriority('')
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function submit() {
    const input: UpsertRoutingRuleInput = { kind }

    if (kind === 'exclusive') {
      if (!keyword.trim()) {
        toast.error('Keyword is required')
        return
      }
      if (!repUserId) {
        toast.error('Rep is required')
        return
      }
      input.keyword = keyword.trim().toLowerCase()
      input.repUserId = repUserId
    } else if (kind === 'pool_keyword') {
      if (!keyword.trim()) {
        toast.error('Keyword is required')
        return
      }
      if (!pool.trim()) {
        toast.error('Pool name is required')
        return
      }
      input.keyword = keyword.trim().toLowerCase()
      input.pool = pool.trim().toLowerCase()
    } else {
      if (!pool.trim()) {
        toast.error('Pool name is required')
        return
      }
      if (!repUserId) {
        toast.error('Rep is required')
        return
      }
      input.pool = pool.trim().toLowerCase()
      input.repUserId = repUserId
    }

    // Priority: blank → 0; ignore non-finite values defensively.
    const trimmedPriority = priority.trim()
    if (trimmedPriority) {
      const n = Number(trimmedPriority)
      if (!Number.isFinite(n)) {
        toast.error('Priority must be a number')
        return
      }
      input.priority = Math.trunc(n)
    }

    try {
      await upsert.mutateAsync(input)
      toast.success('Rule saved')
      handleClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New routing rule</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label>Kind</Label>
            <RadioGroup
              value={kind}
              onValueChange={(v: string) => {
                setKind(v as RoutingRuleKind)
                setKeyword('')
                setPool('')
                setRepUserId('')
                setPriority('')
              }}
              className="space-y-1"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="exclusive" id="kind-exclusive" />
                <Label htmlFor="kind-exclusive" className="cursor-pointer font-normal">
                  Exclusive — keyword → single rep
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="pool_keyword" id="kind-pool-keyword" />
                <Label htmlFor="kind-pool-keyword" className="cursor-pointer font-normal">
                  Pool keyword — keyword → round-robin pool
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="pool_member" id="kind-pool-member" />
                <Label htmlFor="kind-pool-member" className="cursor-pointer font-normal">
                  Pool member — add a rep to a pool
                </Label>
              </div>
            </RadioGroup>
          </div>

          {(kind === 'exclusive' || kind === 'pool_keyword') && (
            <div className="space-y-1.5">
              <Label htmlFor="rule-keyword">Keyword</Label>
              <Input
                id="rule-keyword"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={kind === 'exclusive' ? 'bmw, acme, …' : 'automobile, tech, …'}
              />
              <p className="text-muted-foreground text-xs">Lowercase; matched against the conversation topic.</p>
            </div>
          )}

          {(kind === 'pool_keyword' || kind === 'pool_member') && (
            <div className="space-y-1.5">
              <Label htmlFor="rule-pool">Pool name</Label>
              <Input
                id="rule-pool"
                value={pool}
                onChange={(e) => setPool(e.target.value)}
                placeholder="auto-sales, enterprise, …"
              />
              {existingPools.length > 0 && (
                <p className="text-muted-foreground text-xs">Existing pools: {existingPools.join(', ')}</p>
              )}
            </div>
          )}

          {(kind === 'exclusive' || kind === 'pool_member') && (
            <div className="space-y-1.5">
              <Label htmlFor="rule-rep">Rep</Label>
              <Select value={repUserId} onValueChange={setRepUserId}>
                <SelectTrigger id="rule-rep">
                  <SelectValue placeholder="Select rep…" />
                </SelectTrigger>
                <SelectContent>
                  {staffList.map((s) => (
                    <SelectItem key={s.userId} value={s.userId}>
                      {s.displayName ?? s.userId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rule-priority">Priority</Label>
            <Input
              id="rule-priority"
              type="number"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              placeholder="10"
            />
            <p className="text-muted-foreground text-xs">
              Tie-break between keyword matches of the same length. Higher wins. Defaults to 0.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={upsert.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={upsert.isPending}>
            {upsert.isPending ? 'Saving…' : 'Save rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Section cards ─────────────────────────────────────────────────────────────

function ExclusiveSection({
  rules,
  staffList,
  onDelete,
}: {
  rules: RoutingRule[]
  staffList: ReturnType<typeof useStaffList>['data']
  onDelete: (rule: RoutingRule) => void
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Tag className="size-4" />
          Exclusive matches
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rules.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No exclusive matches. Use these when a single account should always route to one rep (e.g.{' '}
            <code className="font-mono">acme</code> → a specific rep).
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="secondary" className="font-mono">
                    {rule.keyword}
                  </Badge>
                  <PriorityBadge value={rule.priority} />
                  <span className="text-muted-foreground">→</span>
                  <span>{repNameFor(staffList, rule.repUserId)}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive hover:text-destructive"
                  onClick={() => onDelete(rule)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function PoolKeywordSection({ rules, onDelete }: { rules: RoutingRule[]; onDelete: (rule: RoutingRule) => void }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="size-4" />
          Pool keywords
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rules.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No keyword pools. Match a sector to a round-robin pool (e.g. <code className="font-mono">automobile</code> →{' '}
            <code className="font-mono">auto-sales</code>).
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="secondary" className="font-mono">
                    {rule.keyword}
                  </Badge>
                  <PriorityBadge value={rule.priority} />
                  <span className="text-muted-foreground">→</span>
                  <Badge variant="outline" className="font-mono">
                    {rule.pool}
                  </Badge>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive hover:text-destructive"
                  onClick={() => onDelete(rule)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function PoolMemberSection({
  rules,
  staffList,
  onDelete,
}: {
  rules: RoutingRule[]
  staffList: ReturnType<typeof useStaffList>['data']
  onDelete: (rule: RoutingRule) => void
}) {
  // Group by pool name
  const byPool = useMemo(() => {
    const map = new Map<string, RoutingRule[]>()
    for (const rule of rules) {
      const poolName = rule.pool ?? '(unnamed)'
      const existing = map.get(poolName) ?? []
      existing.push(rule)
      map.set(poolName, existing)
    }
    return map
  }, [rules])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4" />
          Pool members
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rules.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No pool members. Add reps to a pool so they take rotated leads.
          </p>
        ) : (
          <div className="space-y-4">
            {Array.from(byPool.entries()).map(([poolName, poolRules]) => (
              <div key={poolName}>
                <div className="mb-1.5 flex items-center gap-2">
                  <Badge variant="outline" className="font-mono">
                    {poolName}
                  </Badge>
                </div>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {poolRules.map((rule) => (
                    <li key={rule.id} className="flex items-center justify-between px-3 py-2">
                      <div className="flex items-center gap-2 text-sm">
                        <span>{repNameFor(staffList, rule.repUserId)}</span>
                        <PriorityBadge value={rule.priority} />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive hover:text-destructive"
                        onClick={() => onDelete(rule)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function repNameFor(staffList: ReturnType<typeof useStaffList>['data'], userId: string | null): string {
  if (!userId) return '—'
  const found = staffList?.find((s) => s.userId === userId)
  return found?.displayName ?? userId
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function RoutingRulesPage() {
  const { data: rules = [], isLoading, error } = useRoutingRules()
  const { data: staffList = [] } = useStaffList()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<RoutingRule | null>(null)

  const exclusiveRules = useMemo(() => rules.filter((r) => r.kind === 'exclusive'), [rules])
  const poolKeywordRules = useMemo(() => rules.filter((r) => r.kind === 'pool_keyword'), [rules])
  const poolMemberRules = useMemo(() => rules.filter((r) => r.kind === 'pool_member'), [rules])

  const existingPools = useMemo(() => {
    const s = new Set<string>()
    for (const r of rules) if (r.pool) s.add(r.pool)
    return Array.from(s).sort()
  }, [rules])

  const corporateMembers = useMemo(() => staffList.filter((s) => s.attributes?.corporate_team === true), [staffList])
  const privateMembers = useMemo(() => staffList.filter((s) => s.attributes?.private_team === true), [staffList])

  return (
    <PageLayout>
      <PageHeader
        title="Routing rules"
        description="Configure how Corporate leads are assigned to reps and pools."
        backTo={{ to: '/team', label: 'Team' }}
        actions={
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-1 size-4" />
            New rule
          </Button>
        }
      />

      <PageBody>
        {isLoading && <div className="text-muted-foreground text-sm">Loading rules…</div>}
        {error && <div className="text-destructive text-sm">Failed to load routing rules</div>}
        {!isLoading && !error && (
          <div className="space-y-4">
            <HowRoutingDecidesCard />
            <div className="grid gap-4 md:grid-cols-2">
              <TeamMembershipCard
                title="Corporate team"
                icon={<Briefcase className="size-4" />}
                attributeKey="corporate_team"
                members={corporateMembers}
                emptyHint="Add the attribute on a staff member's profile to populate this team."
              />
              <TeamMembershipCard
                title="Private team"
                icon={<User className="size-4" />}
                attributeKey="private_team"
                members={privateMembers}
                emptyHint="Add the attribute on a staff member's profile to populate this team."
              />
            </div>
            <ExclusiveSection rules={exclusiveRules} staffList={staffList} onDelete={setDeleteTarget} />
            <PoolKeywordSection rules={poolKeywordRules} onDelete={setDeleteTarget} />
            <PoolMemberSection rules={poolMemberRules} staffList={staffList} onDelete={setDeleteTarget} />
          </div>
        )}
      </PageBody>

      <NewRuleDialog open={dialogOpen} onClose={() => setDialogOpen(false)} existingPools={existingPools} />

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DeleteRuleConfirm target={deleteTarget} onClose={() => setDeleteTarget(null)} />
      </AlertDialog>
    </PageLayout>
  )
}

export const Route = createFileRoute('/_app/team/routing')({
  component: RoutingRulesPage,
})
