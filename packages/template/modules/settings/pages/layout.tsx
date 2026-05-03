import { zodResolver } from '@hookform/resolvers/zod'
import { useSettingsSave } from '@modules/settings/hooks/use-settings-save'
import type { ApiKeysValues, AppearanceValues, NotificationsValues } from '@modules/settings/pages/schemas'
import { apiKeysSchema, appearanceSchema, notificationsSchema } from '@modules/settings/pages/schemas'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'

import { InfoCard, InfoRow, InfoSection } from '@/components/info'
import { PageBody, PageHeader, PageLayout } from '@/components/layout/page-layout'
import { SettingsSegmented, SettingsToggle } from '@/components/settings'
import { useTheme } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { settingsClient } from '@/lib/api-client'

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: <SunIcon /> },
  { value: 'dark', label: 'Dark', icon: <MoonIcon /> },
  { value: 'system', label: 'System', icon: <MonitorIcon /> },
]

const FONT_SIZE_OPTIONS = [
  { value: 'sm', label: 'Small' },
  { value: 'md', label: 'Medium' },
  { value: 'lg', label: 'Large' },
]

const FONT_SIZE_MAP: Record<string, string> = {
  sm: '13px',
  md: '15px',
  lg: '17px',
}

interface NotificationPrefsResponse {
  userId: string
  mentionsEnabled: boolean
  whatsappEnabled: boolean
  emailEnabled: boolean
  updatedAt: string
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  const { mutate, isPending } = useSettingsSave('appearance', appearanceSchema)
  const form = useForm<AppearanceValues>({
    resolver: zodResolver(appearanceSchema),
    defaultValues: { fontSize: 'md' },
  })
  const fontSize = useWatch({ control: form.control, name: 'fontSize' })

  useEffect(() => {
    if (fontSize) document.documentElement.style.fontSize = FONT_SIZE_MAP[fontSize] ?? '15px'
  }, [fontSize])

  async function onSubmit(values: AppearanceValues) {
    await mutate({ ...values, theme })
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <InfoSection
        title="Appearance"
        actions={
          <Button size="sm" type="submit" disabled={isPending}>
            {isPending ? 'Saving…' : 'Save'}
          </Button>
        }
      >
        <InfoCard>
          <InfoRow label="Theme">
            <SettingsSegmented
              name="theme"
              value={theme}
              onValueChange={(v) => setTheme(v as 'light' | 'dark' | 'system')}
              options={THEME_OPTIONS}
              className="w-full sm:w-[260px]"
            />
          </InfoRow>
          <InfoRow label="Font size">
            <SettingsSegmented
              name="fontSize"
              value={form.watch('fontSize') ?? 'md'}
              onValueChange={(v) => form.setValue('fontSize', v as 'sm' | 'md' | 'lg')}
              options={FONT_SIZE_OPTIONS}
              className="w-full sm:w-[260px]"
            />
          </InfoRow>
        </InfoCard>
      </InfoSection>
    </form>
  )
}

function NotificationsSection() {
  const { mutate, isPending } = useSettingsSave('notifications', notificationsSchema)
  const { data } = useQuery({
    queryKey: ['settings', 'notifications'],
    queryFn: async (): Promise<NotificationPrefsResponse> => {
      const r = await settingsClient.notifications.$get()
      if (!r.ok) throw new Error(`notifications.get failed: ${r.status}`)
      return (await r.json()) as NotificationPrefsResponse
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
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <InfoSection
        title="Notifications"
        actions={
          <Button size="sm" type="submit" disabled={isPending}>
            {isPending ? 'Saving…' : 'Save'}
          </Button>
        }
      >
        <InfoCard>
          <SettingsToggle
            label="Mention notifications"
            description="Notify me when an internal note mentions me."
            checked={form.watch('mentionsEnabled') ?? true}
            onCheckedChange={(v) => form.setValue('mentionsEnabled', v)}
          />
          <SettingsToggle
            label="WhatsApp"
            description="Ping me on WhatsApp when mentioned while offline (last seen > 2 min ago)."
            checked={form.watch('whatsappEnabled') ?? false}
            onCheckedChange={(v) => form.setValue('whatsappEnabled', v)}
          />
          <SettingsToggle
            label="Email"
            checked={form.watch('emailEnabled') ?? false}
            onCheckedChange={(v) => form.setValue('emailEnabled', v)}
          />
        </InfoCard>
      </InfoSection>
    </form>
  )
}

function ApiKeysSection() {
  const { mutate, isPending } = useSettingsSave('api-keys', apiKeysSchema)
  const form = useForm<ApiKeysValues>({
    resolver: zodResolver(apiKeysSchema),
    defaultValues: { name: '', scope: '' },
  })

  async function onSubmit(values: ApiKeysValues) {
    await mutate(values)
    form.reset()
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <InfoSection
        title="API Keys"
        description="No keys yet. Create one below to authenticate the Vobase CLI or external integrations."
        actions={
          <Button size="sm" type="submit" disabled={isPending}>
            {isPending ? 'Creating…' : 'Create key'}
          </Button>
        }
      >
        <InfoCard>
          <InfoRow label="Key name">
            <Input className="w-full sm:w-[280px]" placeholder="My API key" {...form.register('name')} />
          </InfoRow>
          <InfoRow label="Scope">
            <Select value={form.watch('scope') ?? ''} onValueChange={(v) => form.setValue('scope', v)}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Select scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read">Read</SelectItem>
                <SelectItem value="write">Write</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </InfoRow>
        </InfoCard>
      </InfoSection>
    </form>
  )
}

export function SettingsPage() {
  return (
    <PageLayout>
      <PageHeader title="Settings" description="Personal preferences and access keys." />
      <PageBody>
        <div className="mx-auto w-full max-w-4xl space-y-8">
          <AppearanceSection />
          <NotificationsSection />
          <ApiKeysSection />
        </div>
      </PageBody>
    </PageLayout>
  )
}

export default SettingsPage

export const Route = createFileRoute('/_app/settings')({
  component: SettingsPage,
})
