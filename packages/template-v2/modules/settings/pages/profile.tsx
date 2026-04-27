import { zodResolver } from '@hookform/resolvers/zod'
import { useSettingsSave } from '@modules/settings/hooks/use-settings-save'
import type { ProfileValues } from '@modules/settings/pages/schemas'
import { profileSchema } from '@modules/settings/pages/schemas'
import { useForm } from 'react-hook-form'

import { AgentViewPane } from '@/components/agent-view-pane'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { useCurrentUserId } from '@/hooks/use-current-user'

export default function ProfilePage() {
  const { mutate, isPending } = useSettingsSave('profile', profileSchema)
  const userId = useCurrentUserId()

  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { displayName: '', email: '' },
  })

  async function onSubmit(values: ProfileValues) {
    await mutate(values)
  }

  return (
    <div className="max-w-lg space-y-6 p-6">
      <div>
        <h2 className="font-semibold text-lg">Profile</h2>
        <p className="text-muted-foreground text-sm">Update your display name and email address.</p>
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="displayName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Display name</FormLabel>
                <FormControl>
                  <Input placeholder="Your name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input type="email" placeholder="you@example.com" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Saving…' : 'Save profile'}
          </Button>
        </form>
      </Form>

      {userId && <AgentViewPane scope={`/staff/${userId}`} />}
    </div>
  )
}

import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/_app/settings/profile')({
  component: ProfilePage,
})
