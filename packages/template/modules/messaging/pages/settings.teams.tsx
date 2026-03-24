import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ArrowLeft, Plus, Trash2, User, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ─── Types ───────────────────────────────────────────────────────────

interface TeamListItem {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt: string;
}

interface TeamDetail {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  members: TeamMember[];
}

interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: string;
  createdAt: string;
}

interface AuthUser {
  id: string;
  name: string;
  email: string;
}

// ─── Fetchers ────────────────────────────────────────────────────────

async function fetchTeams(): Promise<TeamListItem[]> {
  const res = await fetch('/api/messaging/teams');
  if (!res.ok) throw new Error('Failed to fetch teams');
  return res.json();
}

async function fetchTeam(id: string): Promise<TeamDetail> {
  const res = await fetch(`/api/messaging/teams/${id}`);
  if (!res.ok) throw new Error('Failed to fetch team');
  return res.json();
}

async function fetchUsers(): Promise<AuthUser[]> {
  const res = await fetch('/api/auth/admin/list-users', {
    method: 'GET',
  });
  if (!res.ok) return [];
  const data = await res.json();
  // better-auth returns { users: [...] }
  return Array.isArray(data) ? data : (data.users ?? []);
}

// ─── Helpers ─────────────────────────────────────────────────────────

function truncateId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

// ─── Create Team Dialog ─────────────────────────────────────────────

function CreateTeamDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/messaging/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: description || undefined,
        }),
      });
      if (!res.ok) throw new Error('Failed to create team');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messaging-teams'] });
      onOpenChange(false);
      setName('');
      setDescription('');
      toast.success('Team created');
    },
    onError: () => {
      toast.error('Failed to create team');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Team</DialogTitle>
          <DialogDescription>
            Create a team to organize conversation assignment.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="team-name">Name</Label>
            <Input
              id="team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Support Team"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="team-desc">Description</Label>
            <Input
              id="team-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Handles customer support inquiries"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!name.trim() || mutation.isPending}
          >
            {mutation.isPending ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add Member Dialog ──────────────────────────────────────────────

function AddMemberDialog({
  open,
  onOpenChange,
  teamId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: string;
}) {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<'member' | 'lead'>('member');

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/messaging/teams/${teamId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role }),
      });
      if (!res.ok) throw new Error('Failed to add member');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['messaging-team', teamId],
      });
      queryClient.invalidateQueries({ queryKey: ['messaging-teams'] });
      onOpenChange(false);
      setUserId('');
      setRole('member');
      toast.success('Member added');
    },
    onError: () => {
      toast.error('Failed to add member');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Member</DialogTitle>
          <DialogDescription>
            Add a user to this team by their user ID.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="member-user-id">User ID</Label>
            <Input
              id="member-user-id"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="Enter user ID"
            />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as 'member' | 'lead')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="lead">Lead</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!userId.trim() || mutation.isPending}
          >
            {mutation.isPending ? 'Adding...' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete Confirmation Dialog ──────────────────────────────────────

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? 'Deleting...' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Team Detail View ───────────────────────────────────────────────

function TeamDetailView({
  teamId,
  onBack,
}: {
  teamId: string;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [removingMember, setRemovingMember] = useState<TeamMember | null>(null);

  const { data: team } = useQuery({
    queryKey: ['messaging-team', teamId],
    queryFn: () => fetchTeam(teamId),
  });

  const { data: users = [] } = useQuery({
    queryKey: ['auth-users'],
    queryFn: fetchUsers,
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(
        `/api/messaging/teams/${teamId}/members/${userId}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error('Failed to remove member');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['messaging-team', teamId],
      });
      queryClient.invalidateQueries({ queryKey: ['messaging-teams'] });
      setRemovingMember(null);
      toast.success('Member removed');
    },
    onError: () => {
      toast.error('Failed to remove member');
    },
  });

  function getUserName(userId: string): string {
    const user = users.find((u) => u.id === userId);
    return user?.name ?? truncateId(userId);
  }

  if (!team) {
    return <p className="text-sm text-muted-foreground p-6">Loading...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="size-8" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h3 className="text-sm font-semibold">{team.name}</h3>
          {team.description && (
            <p className="text-xs text-muted-foreground">{team.description}</p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Members ({team.members.length})
        </h4>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAddMemberOpen(true)}
        >
          <Plus className="size-3.5 mr-1" />
          Add Member
        </Button>
      </div>

      {team.members.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg gap-3">
          <User className="size-7 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium">No members</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Add members to assign conversations to this team.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAddMemberOpen(true)}
            className="mt-1"
          >
            <Plus className="size-3.5 mr-1.5" />
            Add Member
          </Button>
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          {team.members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between px-4 py-2.5"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center size-6 rounded-full bg-muted text-muted-foreground">
                  <User className="size-3" />
                </div>
                <span className="text-sm font-medium">
                  {getUserName(member.userId)}
                </span>
                <Badge variant="secondary" className="text-xs">
                  {member.role}
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-destructive hover:text-destructive"
                onClick={() => setRemovingMember(member)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {addMemberOpen && (
        <AddMemberDialog
          open={addMemberOpen}
          onOpenChange={setAddMemberOpen}
          teamId={teamId}
        />
      )}

      {removingMember && (
        <ConfirmDialog
          open={!!removingMember}
          onOpenChange={(open) => {
            if (!open) setRemovingMember(null);
          }}
          title="Remove member"
          description={
            <>
              Remove{' '}
              <span className="font-medium text-foreground">
                {getUserName(removingMember.userId)}
              </span>{' '}
              from this team? They will no longer be assigned conversations
              routed to this team.
            </>
          }
          confirmLabel="Remove member"
          onConfirm={() => removeMemberMutation.mutate(removingMember.userId)}
          isPending={removeMemberMutation.isPending}
        />
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────

function TeamSettingsPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [deletingTeam, setDeletingTeam] = useState<TeamListItem | null>(null);

  const { data: teams = [], isLoading } = useQuery({
    queryKey: ['messaging-teams'],
    queryFn: fetchTeams,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/messaging/teams/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete team');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messaging-teams'] });
      setDeletingTeam(null);
      toast.success('Team deleted');
    },
    onError: () => {
      toast.error('Failed to delete team');
    },
  });

  if (selectedTeamId) {
    return (
      <div className="flex flex-col gap-6 p-6 lg:p-10">
        <TeamDetailView
          teamId={selectedTeamId}
          onBack={() => setSelectedTeamId(null)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-10">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Teams</h2>
          <p className="text-sm text-muted-foreground">
            Manage teams for conversation assignment and routing
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} size="sm">
          <Plus className="size-4 mr-1.5" />
          New Team
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : teams.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border rounded-lg gap-3">
          <Users className="size-8 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium">No teams</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Create a team to organize conversation assignment and routing.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="mt-1"
          >
            <Plus className="size-4 mr-1.5" />
            New Team
          </Button>
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              className="flex w-full items-center justify-between px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors text-left"
              onClick={() => setSelectedTeamId(team.id)}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{team.name}</p>
                  <Badge variant="secondary" className="text-xs">
                    {team.memberCount} member{team.memberCount !== 1 ? 's' : ''}
                  </Badge>
                </div>
                {team.description && (
                  <p className="text-xs text-muted-foreground truncate">
                    {team.description}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-destructive hover:text-destructive shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeletingTeam(team);
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </button>
          ))}
        </div>
      )}

      {createOpen && (
        <CreateTeamDialog open={createOpen} onOpenChange={setCreateOpen} />
      )}

      {deletingTeam && (
        <ConfirmDialog
          open={!!deletingTeam}
          onOpenChange={(open) => {
            if (!open) setDeletingTeam(null);
          }}
          title="Delete team"
          description={
            <>
              Are you sure you want to delete{' '}
              <span className="font-medium text-foreground">
                {deletingTeam.name}
              </span>
              ? This action cannot be undone. Members will be removed and
              inboxes assigned to this team will lose their team assignment.
            </>
          }
          confirmLabel="Delete team"
          onConfirm={() => deleteMutation.mutate(deletingTeam.id)}
          isPending={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/_app/messaging/settings/teams')({
  component: TeamSettingsPage,
});
