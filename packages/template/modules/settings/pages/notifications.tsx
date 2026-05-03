import { zodResolver } from '@hookform/resolvers/zod'
import { useSettingsSave } from '@modules/settings/hooks/use-settings-save'
import type { NotificationsValues } from '@modules/settings/pages/schemas'
import { notificationsSchema } from '@modules/settings/pages/schemas'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'

import { SettingsCard, SettingsSection, SettingsToggle } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { settingsClient } from '@/lib/api-client'

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
      const r = await settingsClient.notifications.$get()
      if (!r.ok) throw new Error(`notifications.get failed: ${r.status}`)
      return (await r.json()) as NotificationPrefsResponse
    },
  })

  const { handleSubmit, watch, setValue, reset } = useForm<NotificationsValues>({
    resolver: zodResolver(notificationsSchema),
    defaultValues: { mentionsEnabled: true, whatsappEnabled: false, emailEnabled: false },
  })

  useEffect(() => {
    if (data) {
      reset({
        mentionsEnabled: data.mentionsEnabled,
        whatsappEnabled: data.whatsappEnabled,
        emailEnabled: data.emailEnabled,
      })
    }
  }, [data, reset])

  async function onSubmit(values: NotificationsValues) {
    await mutate(values)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <SettingsSection title="Notifications">
        <SettingsCard>
          <SettingsToggle
            label="Mention notifications"
            description="Notify me when an internal note mentions me."
            checked={watch('mentionsEnabled') ?? true}
            onCheckedChange={(v) => setValue('mentionsEnabled', v)}
          />
          <SettingsToggle
            label="WhatsApp"
            description="Ping me on WhatsApp when mentioned while offline (last seen > 2 min ago)."
            checked={watch('whatsappEnabled') ?? false}
            onCheckedChange={(v) => setValue('whatsappEnabled', v)}
          />
          <SettingsToggle
            label="Email"
            checked={watch('emailEnabled') ?? false}
            onCheckedChange={(v) => setValue('emailEnabled', v)}
          />
        </SettingsCard>
        <div className="flex justify-end pt-2">
          <Button size="sm" type="submit" disabled={isPending}>
            {isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </SettingsSection>
    </form>
  )
}

export const Route = createFileRoute('/_app/settings/notifications')({
  component: NotificationsPage,
})
