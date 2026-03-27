import { createFileRoute } from '@tanstack/react-router';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';

function getInitials(
  name: string | undefined | null,
  email: string | undefined | null,
): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2)
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return '??';
}

function ProfilePage() {
  const { data: session } = authClient.useSession();
  const user = session?.user;
  const initials = getInitials(user?.name, user?.email);

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">Profile</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Manage your personal information.
        </p>
      </div>

      <div className="mb-6 flex items-center gap-4">
        <Avatar size="lg">
          <AvatarFallback className="text-base">{initials}</AvatarFallback>
        </Avatar>
        <div>
          <p className="font-medium text-sm">
            {user?.name ?? user?.email ?? 'Account'}
          </p>
          {user?.email && user.name && (
            <p className="text-sm text-muted-foreground">{user.email}</p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            defaultValue={user?.name ?? ''}
            placeholder="Your name"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            defaultValue={user?.email ?? ''}
            readOnly
            className="text-muted-foreground"
          />
        </div>
        <div className="mt-2">
          <Button disabled>Save changes</Button>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/settings/profile')({
  component: ProfilePage,
});
