import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form'
import { useSettingsSave } from '@/features/settings/api/use-settings-save'
import { notificationsSchema } from '@/features/settings/schemas'
import type { NotificationsValues } from '@/features/settings/schemas'

export default function NotificationsPage() {
  const { mutate, isPending } = useSettingsSave('notifications', notificationsSchema)

  const form = useForm<NotificationsValues>({
    resolver: zodResolver(notificationsSchema),
    defaultValues: { emailEnabled: true, pushEnabled: false },
  })

  async function onSubmit(values: NotificationsValues) {
    await mutate(values)
  }

  return (
    <div className="max-w-lg space-y-6 p-6">
      <div>
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="text-sm text-muted-foreground">Choose how you want to be notified.</p>
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="emailEnabled"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                <FormLabel className="cursor-pointer">Email notifications</FormLabel>
                <FormControl>
                  <input
                    type="checkbox"
                    checked={field.value ?? false}
                    onChange={e => field.onChange(e.target.checked)}
                    className="h-4 w-4"
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="pushEnabled"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                <FormLabel className="cursor-pointer">Push notifications</FormLabel>
                <FormControl>
                  <input
                    type="checkbox"
                    checked={field.value ?? false}
                    onChange={e => field.onChange(e.target.checked)}
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
