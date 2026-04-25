import { zodResolver } from '@hookform/resolvers/zod'
import { useSettingsSave } from '@server/admin/settings/pages/api/use-settings-save'
import type { NotificationsValues } from '@server/admin/settings/pages/schemas'
import { notificationsSchema } from '@server/admin/settings/pages/schemas'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'

import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form'

interface NotificationPrefsResponse {
  userId: string
  mentionsEnabled: boolean
  whatsappEnabled: boolean
  emailEnabled: boolean
  updatedAt: string
}

export default function NotificationsPage() {
  const { mutate, isPending } = useSettingsSave('notifications', notificationsSchema)
  const { data } = useQuery({
    queryKey: ['settings', 'notifications'],
    queryFn: async (): Promise<NotificationPrefsResponse> => {
      const r = await fetch('/api/settings/notifications')
      if (!r.ok) throw new Error(`notifications.get failed: ${r.status}`)
      return r.json()
    },
  })

  const form = useForm<NotificationsValues>({
    resolver: zodResolver(notificationsSchema),
    defaultValues: { mentionsEnabled: true, whatsappEnabled: false, emailEnabled: false },
  })

  useEffect(() => {
    if (data) {
      form.reset({
        mentionsEnabled: data.mentionsEnabled,
        whatsappEnabled: data.whatsappEnabled,
        emailEnabled: data.emailEnabled,
      })
    }
  }, [data, form])

  async function onSubmit(values: NotificationsValues) {
    await mutate(values)
  }

  return (
    <div className="max-w-lg space-y-6 p-6">
      <div>
        <h2 className="font-semibold text-lg">Notifications</h2>
        <p className="text-muted-foreground text-sm">
          Choose how you want to be notified. WhatsApp pings fire when you're mentioned in an internal note while
          offline (last seen &gt; 2 min ago).
        </p>
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="mentionsEnabled"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                <div>
                  <FormLabel className="cursor-pointer">Mention notifications</FormLabel>
                  <p className="text-muted-foreground text-xs">Notify me when an internal note mentions me.</p>
                </div>
                <FormControl>
                  <input
                    type="checkbox"
                    checked={field.value ?? false}
                    onChange={(e) => field.onChange(e.target.checked)}
                    className="h-4 w-4"
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="whatsappEnabled"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                <FormLabel className="cursor-pointer">WhatsApp</FormLabel>
                <FormControl>
                  <input
                    type="checkbox"
                    checked={field.value ?? false}
                    onChange={(e) => field.onChange(e.target.checked)}
                    className="h-4 w-4"
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="emailEnabled"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                <FormLabel className="cursor-pointer">Email</FormLabel>
                <FormControl>
                  <input
                    type="checkbox"
                    checked={field.value ?? false}
                    onChange={(e) => field.onChange(e.target.checked)}
                    className="h-4 w-4"
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Saving…' : 'Save notifications'}
          </Button>
        </form>
      </Form>
    </div>
  )
}

import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/_app/settings/notifications')({
  component: NotificationsPage,
})
