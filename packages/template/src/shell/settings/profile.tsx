import { zodResolver } from '@hookform/resolvers/zod';
import { createFileRoute } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { ContentSection } from '@/components/content-section';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';

const profileSchema = z.object({
  name: z.string().min(1, 'Name is required'),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

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

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: user?.name ?? '',
    },
  });

  async function onSubmit(data: ProfileFormValues) {
    await authClient.updateUser({ name: data.name });
    toast.success('Profile updated');
  }

  return (
    <ContentSection title="Profile" desc="Manage your personal information.">
      <div className="mb-6 flex items-center gap-4">
        <Avatar size="lg">
          <AvatarFallback className="text-base">{initials}</AvatarFallback>
        </Avatar>
        <div>
          <p className="text-sm font-medium">
            {user?.name ?? user?.email ?? 'Account'}
          </p>
          {user?.email && user.name && (
            <p className="text-sm text-muted-foreground">{user.email}</p>
          )}
        </div>
      </div>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input placeholder="Your name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="email-readonly"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Email
            </label>
            <Input
              id="email-readonly"
              type="email"
              value={user?.email ?? ''}
              readOnly
              className="text-muted-foreground"
            />
          </div>

          <div className="mt-2">
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Save changes
            </Button>
          </div>
        </form>
      </Form>
    </ContentSection>
  );
}

export const Route = createFileRoute('/_app/settings/profile')({
  component: ProfilePage,
});
