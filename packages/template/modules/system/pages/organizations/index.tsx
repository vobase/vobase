import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { BuildingIcon, SendIcon, UserMinusIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { authClient } from '@/lib/auth-client';

const ROLES = ['owner', 'admin', 'member'] as const;

const roleBadgeVariant: Record<string, 'default' | 'secondary' | 'outline'> = {
  owner: 'default',
  admin: 'secondary',
  member: 'outline',
};

const inviteSchema = z.object({
  email: z.string().email('Valid email required'),
  role: z.enum(['admin', 'member']),
});

const ORG_DETAIL_KEY = ['organization-detail'] as const;

const allowedEmailDomains = import.meta.env.VITE_ALLOWED_EMAIL_DOMAINS
  ? (import.meta.env.VITE_ALLOWED_EMAIL_DOMAINS as string)
      .split(',')
      .map((d: string) => d.trim())
      .filter(Boolean)
  : [];

function OrganizationPage() {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id;
  const activeOrgId = session?.session?.activeOrganizationId;

  // Auto-activate first org if user has orgs but none is active
  const listQuery = useQuery({
    queryKey: ['organization-list'],
    queryFn: async () => {
      const result = await authClient.organization.list();
      if (result.error) return [];
      return result.data ?? [];
    },
    enabled: !activeOrgId,
  });

  const firstOrgId = (listQuery.data ?? [])[0]?.id;

  useEffect(() => {
    if (firstOrgId && !activeOrgId) {
      authClient.organization.setActive({ organizationId: firstOrgId });
    }
  }, [firstOrgId, activeOrgId]);

  // Fetch active org with members + invitations
  const orgQuery = useQuery({
    queryKey: ORG_DETAIL_KEY,
    queryFn: async () => {
      const result = await authClient.organization.getFullOrganization();
      if (result.error) return null;
      return result.data;
    },
    enabled: !!activeOrgId,
  });

  const org = orgQuery.data;
  const members = org?.members ?? [];
  const invitations = (org?.invitations ?? []).filter(
    (i: { status: string }) => i.status === 'pending',
  );

  // --- Update org ---
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');

  const updateMutation = useMutation({
    mutationFn: async (newName: string) => {
      const result = await authClient.organization.update({
        data: { name: newName },
      });
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      toast.success('Organization updated');
      queryClient.invalidateQueries({ queryKey: ORG_DETAIL_KEY });
      setEditOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // --- Role change ---
  const updateRoleMutation = useMutation({
    mutationFn: async ({
      memberId,
      role,
    }: {
      memberId: string;
      role: string;
    }) => {
      const result = await authClient.organization.updateMemberRole({
        memberId,
        role,
      });
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      toast.success('Member role updated');
      queryClient.invalidateQueries({ queryKey: ORG_DETAIL_KEY });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // --- Remove member ---
  const removeMemberMutation = useMutation({
    mutationFn: async (memberIdOrEmail: string) => {
      const result = await authClient.organization.removeMember({
        memberIdOrEmail,
      });
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      toast.success('Member removed');
      queryClient.invalidateQueries({ queryKey: ORG_DETAIL_KEY });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // --- Invite ---
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');

  const inviteMutation = useMutation({
    mutationFn: async (input: { email: string; role: 'admin' | 'member' }) => {
      const result = await authClient.organization.inviteMember({
        email: input.email,
        role: input.role,
        resend: true,
      });
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      toast.success('Invitation sent');
      queryClient.invalidateQueries({ queryKey: ORG_DETAIL_KEY });
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRole('member');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleInvite() {
    const parsed = inviteSchema.safeParse({
      email: inviteEmail,
      role: inviteRole,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    inviteMutation.mutate(parsed.data);
  }

  // --- Resend invitation ---
  const resendMutation = useMutation({
    mutationFn: async (inv: { email: string; role: 'admin' | 'member' }) => {
      const result = await authClient.organization.inviteMember({
        email: inv.email,
        role: inv.role,
        resend: true,
      });
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      toast.success('Invitation resent');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // --- Cancel invitation ---
  const cancelInviteMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      const result = await authClient.organization.cancelInvitation({
        invitationId,
      });
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      toast.success('Invitation cancelled');
      queryClient.invalidateQueries({ queryKey: ORG_DETAIL_KEY });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // --- No org ---
  if (!activeOrgId && !firstOrgId && !listQuery.isLoading) {
    return (
      <div className="flex flex-col gap-6 p-6 lg:p-10">
        <PageHeader
          title="Organization"
          description="Manage your organization and members"
        />
        <EmptyState
          icon={BuildingIcon}
          title="No organization"
          description="An organization is created automatically during setup."
        />
      </div>
    );
  }

  // --- Loading ---
  if (
    listQuery.isLoading ||
    (!activeOrgId && firstOrgId) ||
    orgQuery.isLoading
  ) {
    return (
      <div className="flex flex-col gap-6 p-6 lg:p-10">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  // --- Active org view ---
  return (
    <div className="flex flex-col gap-6 p-6 lg:p-10">
      <PageHeader
        title="Organization"
        description="Manage your organization and members"
      />

      {/* General Settings */}
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>
            {org?.name} &middot; {org?.slug}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {allowedEmailDomains.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm text-muted-foreground">
                Allowed email domains
              </p>
              <div className="flex flex-wrap gap-1.5">
                {allowedEmailDomains.map((domain) => (
                  <Badge key={domain} variant="secondary">
                    {domain}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Users with these email domains are automatically added when they
                sign in.
              </p>
            </div>
          )}
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditName(org?.name ?? '')}
              >
                Edit Name
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Organization</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-2 py-4">
                <Label htmlFor="edit-name">Name</Label>
                <Input
                  id="edit-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button
                  onClick={() => updateMutation.mutate(editName)}
                  disabled={
                    updateMutation.isPending || editName.trim().length === 0
                  }
                >
                  Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      {/* Members */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              {members.length} member{members.length !== 1 ? 's' : ''}
            </CardDescription>
          </div>
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <SendIcon className="mr-1.5 h-4 w-4" />
                Invite Member
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite Member</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4 py-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="invite-email">Email</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="user@example.com"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Role</Label>
                  <Select
                    value={inviteRole}
                    onValueChange={(v) =>
                      setInviteRole(v as 'admin' | 'member')
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="member">Member</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={handleInvite}
                  disabled={inviteMutation.isPending}
                >
                  {inviteMutation.isPending ? 'Sending...' : 'Send Invitation'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="w-[100px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">
                      {member.user.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {member.user.email}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={member.role}
                        onValueChange={(role) =>
                          updateRoleMutation.mutate({
                            memberId: member.id,
                            role,
                          })
                        }
                        disabled={member.user.id === currentUserId}
                      >
                        <SelectTrigger className="w-[110px]">
                          <SelectValue>
                            <Badge
                              variant={
                                roleBadgeVariant[member.role] ?? 'outline'
                              }
                            >
                              {member.role}
                            </Badge>
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(member.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {member.role !== 'owner' &&
                        member.user.id !== currentUserId && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <UserMinusIcon className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Remove member?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  {member.user.name} will be removed from this
                                  organization.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() =>
                                    removeMemberMutation.mutate(
                                      member.user.email,
                                    )
                                  }
                                >
                                  Remove
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending Invitations</CardTitle>
            <CardDescription>{invitations.length} pending</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="w-[150px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium">{inv.email}</TableCell>
                      <TableCell>
                        <Badge
                          variant={roleBadgeVariant[inv.role] ?? 'outline'}
                        >
                          {inv.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(inv.expiresAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              resendMutation.mutate({
                                email: inv.email,
                                role: inv.role as 'admin' | 'member',
                              })
                            }
                            disabled={resendMutation.isPending}
                          >
                            Resend
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => cancelInviteMutation.mutate(inv.id)}
                            disabled={cancelInviteMutation.isPending}
                          >
                            Cancel
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export const Route = createFileRoute('/_app/system/organizations/')({
  component: OrganizationPage,
});
