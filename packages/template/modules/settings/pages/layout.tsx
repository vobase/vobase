import { zodResolver } from '@hookform/resolvers/zod'
import { useSettingsSave } from '@modules/settings/hooks/use-settings-save'
import type { AppearanceValues, NotificationsValues } from '@modules/settings/pages/schemas'
import { appearanceSchema, notificationsSchema } from '@modules/settings/pages/schemas'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Check, Copy, MonitorIcon, MoonIcon, SunIcon, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'

import { InfoCard, InfoRow, InfoSection } from '@/components/info'
import { PageBody, PageHeader, PageLayout } from '@/components/layout/page-layout'
import { SettingsToggle } from '@/components/settings'
import { SettingsSegmented } from '@/components/settings/settings-segmented'
import { useTheme } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RelativeTimeCard } from '@/components/ui/relative-time'
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

const FONT_SIZE_MAP: Record<string, string> = { sm: '13px', md: '15px', lg: '17px' }

interface NotificationPrefsResponse {
  userId: string
  mentionsEnabled: boolean
  whatsappEnabled: boolean
  emailEnabled: boolean
  updatedAt: string
}

type SaveState = 'idle' | 'saving' | 'saved'

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'saving') return <span className="text-muted-foreground text-xs">Saving…</span>
  if (state === 'saved') {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
        <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
        Saved
      </span>
    )
  }
  return null
}

function useAutoSave<T>(values: T | null | undefined, save: (values: T) => Promise<unknown>): SaveState {
  const [state, setState] = useState<SaveState>('idle')
  const lastSerialized = useRef<string | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (values === null || values === undefined) return
    const next = values
    const serialized = JSON.stringify(next)
    if (lastSerialized.current === null) {
      lastSerialized.current = serialized
      return
    }
    if (lastSerialized.current === serialized) return
    lastSerialized.current = serialized

    const debounce = setTimeout(() => {
      setState('saving')
      save(next)
        .then(() => {
          setState('saved')
          if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
          savedTimerRef.current = setTimeout(() => setState('idle'), 1500)
        })
        .catch(() => setState('idle'))
    }, 400)
    return () => clearTimeout(debounce)
  }, [values, save])

  useEffect(
    () => () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    },
    [],
  )

  return state
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  const { mutate } = useSettingsSave('appearance', appearanceSchema)
  const form = useForm<AppearanceValues>({
    resolver: zodResolver(appearanceSchema),
    defaultValues: { fontSize: 'md' },
  })
  const fontSize = useWatch({ control: form.control, name: 'fontSize' })

  useEffect(() => {
    if (fontSize) document.documentElement.style.fontSize = FONT_SIZE_MAP[fontSize] ?? '15px'
  }, [fontSize])

  const saveState = useAutoSave({ theme, fontSize: fontSize ?? 'md' }, (v) => mutate(v))

  return (
    <InfoSection title="Appearance" actions={<SaveIndicator state={saveState} />}>
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
            value={fontSize ?? 'md'}
            onValueChange={(v) => form.setValue('fontSize', v as 'sm' | 'md' | 'lg')}
            options={FONT_SIZE_OPTIONS}
            className="w-full sm:w-[260px]"
          />
        </InfoRow>
      </InfoCard>
    </InfoSection>
  )
}

function NotificationsSection() {
  const { mutate } = useSettingsSave('notifications', notificationsSchema)
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

  const watched = useWatch({ control: form.control })
  const saveState = useAutoSave<NotificationsValues>(data ? (watched as NotificationsValues) : null, (v) => mutate(v))

  return (
    <InfoSection title="Notifications" actions={<SaveIndicator state={saveState} />}>
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
  )
}

interface ApiKeySummary {
  id: string
  name: string | null
  prefix: string
  start: string | null
  enabled: boolean
  lastRequest: string | null
  createdAt: string
}

interface CreatedApiKeyResponse extends ApiKeySummary {
  key: string
}

function ApiKeysSection() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [revealed, setRevealed] = useState<CreatedApiKeyResponse | null>(null)

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['settings', 'api-keys'],
    queryFn: async (): Promise<ApiKeySummary[]> => {
      const r = await settingsClient['api-keys'].$get()
      if (!r.ok) throw new Error(`api-keys.list failed: ${r.status}`)
      return (await r.json()) as ApiKeySummary[]
    },
  })

  const createMut = useMutation({
    mutationFn: async (input: { name: string }): Promise<CreatedApiKeyResponse> => {
      const r = await settingsClient['api-keys'].$post({ json: input })
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? 'Failed to create key')
      }
      return (await r.json()) as CreatedApiKeyResponse
    },
    onSuccess: (created) => {
      setRevealed(created)
      setName('')
      qc.invalidateQueries({ queryKey: ['settings', 'api-keys'] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to create key'),
  })

  const revokeMut = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const r = await settingsClient['api-keys'][':id'].$delete({ param: { id } })
      if (!r.ok) throw new Error(`api-keys.revoke failed: ${r.status}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'api-keys'] })
      toast.success('Key revoked')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to revoke key'),
  })

  function copyKey() {
    if (!revealed) return
    void navigator.clipboard.writeText(revealed.key).then(() => toast.success('Copied to clipboard'))
  }

  return (
    <InfoSection
      title="API Keys"
      description="Authenticate the Vobase CLI and external integrations."
      actions={
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim().length === 0) return
            createMut.mutate({ name: name.trim() })
          }}
        >
          <Input
            className="h-8 w-[200px]"
            placeholder="Key name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={createMut.isPending}
          />
          <Button size="sm" type="submit" disabled={createMut.isPending || name.trim().length === 0}>
            {createMut.isPending ? 'Creating…' : 'Create key'}
          </Button>
        </form>
      }
    >
      {revealed && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="mb-2 font-medium text-sm">Copy your new key — it won't be shown again.</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md bg-background px-3 py-2 font-mono text-xs">{revealed.key}</code>
            <Button size="sm" variant="outline" onClick={copyKey}>
              <Copy />
              Copy
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRevealed(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      <InfoCard>
        {isLoading && <InfoRow label="Loading…" />}
        {!isLoading && keys.length === 0 && (
          <InfoRow label="No keys yet">
            <span className="text-muted-foreground">Create one above to get started.</span>
          </InfoRow>
        )}
        {keys.map((k) => (
          <InfoRow key={k.id} label={k.name ?? '(unnamed)'}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <code className="font-mono text-muted-foreground text-xs">
                  {k.prefix}
                  {k.start ?? '••••'}…
                </code>
                <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                  Created <RelativeTimeCard date={new Date(k.createdAt)} length="short" />
                  {k.lastRequest && (
                    <>
                      {' · last used '}
                      <RelativeTimeCard date={new Date(k.lastRequest)} length="short" />
                    </>
                  )}
                </span>
              </div>
              <Button size="sm" variant="ghost" disabled={revokeMut.isPending} onClick={() => revokeMut.mutate(k.id)}>
                <Trash2 />
                Revoke
              </Button>
            </div>
          </InfoRow>
        ))}
      </InfoCard>
    </InfoSection>
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
