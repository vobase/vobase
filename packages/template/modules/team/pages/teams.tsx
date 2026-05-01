/**
 * `/team/teams` — CRUD over better-auth organization teams + per-team
 * description (stored in `team.team_descriptions`).
 */

import { createFileRoute } from '@tanstack/react-router'
import { Pencil, Plus, Trash2, UserMinus, UserPlus, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  type OrgMemberRow,
  type TeamRow,
  useAddTeamMember,
  useCreateTeam,
  useOrgMembers,
  useRemoveTeam,
  useRemoveTeamMember,
  useTeamDescriptions,
  useTeamMembers,
  useTeams,
  useUpdateTeam,
  useUpsertTeamDescription,
} from '../hooks/use-teams'

export function TeamsPage() {
  const { data: teams = [], isLoading, error } = useTeams()
  const { data: descriptions = [] } = useTeamDescriptions()
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [editDialog, setEditDialog] = useState<{ mode: 'create' | 'edit'; team: TeamRow | null } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TeamRow | null>(null)

  const selectedTeam = useMemo(() => teams.find((t) => t.id === selectedTeamId) ?? null, [teams, selectedTeamId])
  const descriptionByTeam = useMemo(() => {
    const map = new Map<string, string>()
    for (const d of descriptions) map.set(d.teamId, d.description)
    return map
  }, [descriptions])

  return (
    <PageLayout>
      <PageHeader
        title="Teams"
        description="Organize staff into teams for routing. Descriptions are surfaced to agents as routing context."
        backTo={{ to: '/team', label: 'Team' }}
        actions={
          <Button size="sm" onClick={() => setEditDialog({ mode: 'create', team: null })}>
            <Plus className="mr-1 size-4" />
            New team
          </Button>
        }
      />

      <PageBody padded={false} scroll={false}>
        <div className="grid flex-1 grid-cols-[1fr_1fr] overflow-hidden">
          <div className="flex flex-col overflow-auto border-border border-r">
            {isLoading && <div className="p-6 text-muted-foreground text-sm">Loading teams…</div>}
            {error && <div className="m-6 text-destructive text-sm">Failed to load teams</div>}
            {!isLoading && !error && teams.length === 0 && (
              <div className="flex h-full items-center justify-center">
                <Empty>
                  <EmptyMedia>
                    <Users className="size-5" />
                  </EmptyMedia>
                  <EmptyTitle>No teams yet</EmptyTitle>
                  <EmptyDescription>
                    Create a team to group staff by function (e.g. "Billing", "Eng on-call").
                  </EmptyDescription>
                  <div className="mt-3">
                    <Button size="sm" onClick={() => setEditDialog({ mode: 'create', team: null })}>
                      <Plus className="mr-1 size-4" />
                      New team
                    </Button>
                  </div>
                </Empty>
              </div>
            )}
            {!isLoading && teams.length > 0 && (
              <ul className="divide-y divide-border">
                {teams.map((team) => (
                  <li key={team.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedTeamId(team.id)}
                      className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-muted/50 ${
                        team.id === selectedTeamId ? 'bg-muted' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{team.name}</div>
                        <div className="truncate text-muted-foreground text-xs">
                          {descriptionByTeam.get(team.id) || 'No description'}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditDialog({ mode: 'edit', team })
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeleteTarget(team)
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col overflow-hidden">
            {selectedTeam ? (
              <TeamDetail
                team={selectedTeam}
                description={descriptionByTeam.get(selectedTeam.id) ?? ''}
                key={selectedTeam.id}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-muted-foreground text-sm">
                Select a team to view members and edit its description.
              </div>
            )}
          </div>
        </div>
      </PageBody>

      <TeamFormDialog
        open={Boolean(editDialog)}
        mode={editDialog?.mode ?? 'create'}
        team={editDialog?.team ?? null}
        onClose={() => setEditDialog(null)}
      />

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DeleteTeamConfirm target={deleteTarget} onClose={() => setDeleteTarget(null)} />
      </AlertDialog>
    </PageLayout>
  )
}

function DeleteTeamConfirm({ target, onClose }: { target: TeamRow | null; onClose: () => void }) {
  const remove = useRemoveTeam()
  async function confirm() {
    if (!target) return
    try {
      await remove.mutateAsync(target.id)
      toast.success(`Deleted "${target.name}"`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    }
  }
  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete team "{target?.name}"?</AlertDialogTitle>
        <AlertDialogDescription>
          Removes the team and all member links. Staff profiles are unaffected. This cannot be undone.
        </AlertDialogDescription>
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

function TeamFormDialog({
  open,
  mode,
  team,
  onClose,
}: {
  open: boolean
  mode: 'create' | 'edit'
  team: TeamRow | null
  onClose: () => void
}) {
  const create = useCreateTeam()
  const update = useUpdateTeam()
  const [name, setName] = useState('')

  useEffect(() => {
    if (!open) return
    setName(team?.name ?? '')
  }, [open, team])

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Name is required')
      return
    }
    try {
      if (mode === 'edit' && team) {
        await update.mutateAsync({ teamId: team.id, name: trimmed })
        toast.success('Team updated')
      } else {
        await create.mutateAsync({ name: trimmed })
        toast.success('Team created')
      }
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    }
  }

  const pending = create.isPending || update.isPending

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? 'Edit team' : 'New team'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="team-name">Name</Label>
            <Input
              id="team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Billing, Eng on-call, …"
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Saving…' : mode === 'edit' ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TeamDetail({ team, description }: { team: TeamRow; description: string }) {
  const { data: members = [], isLoading } = useTeamMembers(team.id)
  const { data: orgMembers = [] } = useOrgMembers()
  const upsertDescription = useUpsertTeamDescription()
  const addMember = useAddTeamMember()
  const removeMember = useRemoveTeamMember()
  const [draft, setDraft] = useState(description)
  const [pickerUserId, setPickerUserId] = useState('')

  useEffect(() => {
    setDraft(description)
  }, [description])

  const memberUserIds = useMemo(() => new Set(members.map((m) => m.userId)), [members])
  const availableToAdd = useMemo(
    () => orgMembers.filter((m) => !memberUserIds.has(m.userId)),
    [orgMembers, memberUserIds],
  )

  async function saveDescription() {
    try {
      await upsertDescription.mutateAsync({ teamId: team.id, description: draft })
      toast.success('Description saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    }
  }

  async function onAddMember() {
    if (!pickerUserId) return
    try {
      await addMember.mutateAsync({ teamId: team.id, userId: pickerUserId })
      setPickerUserId('')
      toast.success('Member added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Add failed')
    }
  }

  async function onRemoveMember(userId: string) {
    try {
      await removeMember.mutateAsync({ teamId: team.id, userId })
      toast.success('Member removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Remove failed')
    }
  }

  const memberLabel = (userId: string): string => {
    const m = orgMembers.find((x) => x.userId === userId)
    return m?.user.name || m?.user.email || userId
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="border-border border-b px-6 py-4">
        <h2 className="font-semibold text-lg">{team.name}</h2>
        <p className="text-muted-foreground text-xs">
          Team id: <code className="font-mono">{team.id}</code>
        </p>
      </div>

      <section className="border-border border-b px-6 py-4">
        <div className="mb-2 flex items-center justify-between">
          <Label htmlFor="team-description">Description (for agents)</Label>
          <Button size="sm" onClick={saveDescription} disabled={upsertDescription.isPending || draft === description}>
            {upsertDescription.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
        <Textarea
          id="team-description"
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="When should routing agents pick this team? E.g. 'Enterprise billing escalations; any refund over SGD 500.'"
        />
      </section>

      <section className="flex-1 px-6 py-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-sm">Members</h3>
          <div className="flex items-center gap-2">
            <Select value={pickerUserId} onValueChange={setPickerUserId}>
              <SelectTrigger className="h-8 w-56">
                <SelectValue placeholder="Add member…" />
              </SelectTrigger>
              <SelectContent>
                {availableToAdd.length === 0 && (
                  <div className="px-2 py-1.5 text-muted-foreground text-xs">No more org members</div>
                )}
                {availableToAdd.map((m: OrgMemberRow) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.user.name || m.user.email || m.userId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={onAddMember} disabled={!pickerUserId || addMember.isPending}>
              <UserPlus className="mr-1 size-4" />
              Add
            </Button>
          </div>
        </div>
        {isLoading && <div className="text-muted-foreground text-sm">Loading members…</div>}
        {!isLoading && members.length === 0 && (
          <div className="rounded-md border border-border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
            No members yet.
          </div>
        )}
        {!isLoading && members.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="font-mono text-xs">
                    {m.userId}
                  </Badge>
                  <span className="text-sm">{memberLabel(m.userId)}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive hover:text-destructive"
                  onClick={() => {
                    void onRemoveMember(m.userId)
                  }}
                  disabled={removeMember.isPending}
                >
                  <UserMinus className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export const Route = createFileRoute('/_app/team/teams')({
  component: TeamsPage,
})
