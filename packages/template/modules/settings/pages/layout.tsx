import { zodResolver } from '@hookform/resolvers/zod'
import { useAgentDefinitions } from '@modules/agents/hooks/use-agent-definitions'
import type { ApiKeySummaryDto, CreatedApiKeyDto } from '@modules/settings/handlers/api-keys'
import { useOrgSetting } from '@modules/settings/hooks/use-org-setting'
import { useSettingsSave } from '@modules/settings/hooks/use-settings-save'
import type { NotificationsValues } from '@modules/settings/pages/schemas'
import { notificationsSchema } from '@modules/settings/pages/schemas'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Check, Copy, MonitorIcon, MoonIcon, SunIcon, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Status } from '@/components/ui/status'
import { settingsClient } from '@/lib/api-client'
import { authClient } from '@/lib/auth-client'

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
  approvalsEnabled: boolean
  proposalsEnabled: boolean
  updatedAt: string
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

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
  if (state === 'error') return <span className="text-destructive text-xs">Save failed</span>
  return null
}

function useAutoSave<T>(values: T | null | undefined, save: (values: T) => Promise<unknown>): SaveState {
  const [state, setState] = useState<SaveState>('idle')
  const lastSerialized = useRef<string | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (values === null || values === undefined) return
    const serialized = JSON.stringify(values)
    if (lastSerialized.current === null) {
      lastSerialized.current = serialized
      return
    }
    if (lastSerialized.current === serialized) return
    lastSerialized.current = serialized

    const debounce = setTimeout(() => {
      setState('saving')
      save(values)
        .then(() => {
          setState('saved')
          if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
          savedTimerRef.current = setTimeout(() => setState('idle'), 1500)
        })
        .catch((err) => {
          setState('error')
          toast.error(err instanceof Error ? err.message : 'Save failed')
        })
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
  const [fontSize, setFontSize] = useState<'sm' | 'md' | 'lg'>('md')

  useEffect(() => {
    document.documentElement.style.fontSize = FONT_SIZE_MAP[fontSize] ?? '15px'
  }, [fontSize])

  return (
    <InfoSection title="Appearance">
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
            value={fontSize}
            onValueChange={(v) => setFontSize(v as 'sm' | 'md' | 'lg')}
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
    defaultValues: {
      mentionsEnabled: true,
      whatsappEnabled: false,
      emailEnabled: false,
      approvalsEnabled: true,
      proposalsEnabled: true,
    },
  })

  useEffect(() => {
    if (data) {
      form.reset({
        mentionsEnabled: data.mentionsEnabled,
        whatsappEnabled: data.whatsappEnabled,
        emailEnabled: data.emailEnabled,
        approvalsEnabled: data.approvalsEnabled,
        proposalsEnabled: data.proposalsEnabled,
      })
    }
  }, [data, form])

  const watched = useWatch({ control: form.control })
  const save = useCallback((v: NotificationsValues) => mutate(v), [mutate])
  const saveState = useAutoSave<NotificationsValues>(data ? (watched as NotificationsValues) : null, save)

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
        <SettingsToggle
          label="Approval notifications"
          description="WhatsApp ping when an agent files a pending approval that needs your decision."
          checked={form.watch('approvalsEnabled') ?? true}
          onCheckedChange={(v) => form.setValue('approvalsEnabled', v)}
        />
        <SettingsToggle
          label="Proposal notifications"
          description="WhatsApp ping when a change proposal needs your decision."
          checked={form.watch('proposalsEnabled') ?? true}
          onCheckedChange={(v) => form.setValue('proposalsEnabled', v)}
        />
      </InfoCard>
    </InfoSection>
  )
}

/**
 * Profile section — surfaces the signed-in user's WhatsApp number and gives
 * them a way to self-verify when an admin set or changed it. The phone itself
 * is admin-managed (per the staff/team conventions), so this section is
 * read-only for the user.
 */
function ProfileSection() {
  const sessionRes = authClient.useSession() as unknown as {
    data?: { user?: { phoneNumber?: string | null; phoneNumberVerified?: boolean | null } | null } | null
  } | null
  const user = sessionRes?.data?.user ?? null
  const phone = user?.phoneNumber ?? null
  const verified = user?.phoneNumberVerified === true

  return (
    <InfoSection title="Profile" description="Your account identity for notifications.">
      <InfoCard>
        <InfoRow label="WhatsApp number">
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            {phone ? (
              <span className="font-mono text-sm">{phone}</span>
            ) : (
              <span className="text-muted-foreground text-sm">No WhatsApp number set — ask your admin to add one.</span>
            )}
            <div className="flex items-center gap-3">
              {phone && (
                <Status variant={verified ? 'success' : 'warning'} label={verified ? 'Verified' : 'Unverified'} />
              )}
              {phone && !verified && (
                <Button asChild size="sm" variant="outline">
                  <Link to="/onboard/verify-phone" search={{ next: '/settings' }}>
                    Verify WhatsApp
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </InfoRow>
      </InfoCard>
    </InfoSection>
  )
}

function OperatorAgentSection() {
  const { data: agents = [], isLoading: agentsLoading } = useAgentDefinitions()
  const operator = useOrgSetting('defaultOperatorAgentId')
  const heartbeat = useOrgSetting('operatorHeartbeatEnabled')

  const heartbeatEnabled = heartbeat.value !== 'false'

  return (
    <InfoSection
      title="Automation defaults"
      description="Org-wide defaults for agent-driven automations — which agent handles staff replies and whether scheduled reviews run."
    >
      <InfoCard>
        <InfoRow label="Default agent" className="items-center">
          <div className="space-y-1">
            {agentsLoading ? (
              <span className="text-muted-foreground text-sm">Loading agents…</span>
            ) : (
              <Select
                value={operator.value ?? ''}
                onValueChange={(v) => operator.setValue(v === '__auto__' ? null : v)}
                disabled={operator.isPending}
              >
                <SelectTrigger className="w-[280px]">
                  <SelectValue placeholder="Auto (first enabled)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto__">Auto (first enabled)</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                      {!a.enabled && <span className="ml-1 text-muted-foreground text-xs">(disabled)</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-muted-foreground text-xs">
              The agent that picks up incoming WhatsApp messages when a staff member replies outside an active
              conversation. Defaults to the first enabled agent.
            </p>
          </div>
        </InfoRow>
        <SettingsToggle
          label="Scheduled reviews"
          description="Enable cron-scheduled standalone reviews. When off, only event-triggered automations fire."
          checked={heartbeatEnabled}
          onCheckedChange={(v) => heartbeat.setValue(v ? 'true' : 'false')}
        />
      </InfoCard>
    </InfoSection>
  )
}

function ApiKeysSection() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [revealed, setRevealed] = useState<CreatedApiKeyDto | null>(null)

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['settings', 'api-keys'],
    queryFn: async (): Promise<ApiKeySummaryDto[]> => {
      const r = await settingsClient['api-keys'].$get()
      if (!r.ok) throw new Error(`api-keys.list failed: ${r.status}`)
      return (await r.json()) as ApiKeySummaryDto[]
    },
  })

  const createMut = useMutation({
    mutationFn: async (input: { name: string }): Promise<CreatedApiKeyDto> => {
      const r = await settingsClient['api-keys'].$post({ json: input })
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? 'Failed to create key')
      }
      return (await r.json()) as CreatedApiKeyDto
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
    navigator.clipboard
      .writeText(revealed.key)
      .then(() => toast.success('Copied to clipboard'))
      .catch(() => toast.error('Copy failed'))
  }

  function onSubmitCreate(e: React.FormEvent) {
    e.preventDefault()
    if (name.trim().length === 0) return
    createMut.mutate({ name: name.trim() })
  }

  return (
    <InfoSection title="API Keys" description="Authenticate the Vobase CLI and external integrations.">
      <form className="flex items-center gap-2" onSubmit={onSubmitCreate}>
        <Input
          className="h-8 w-[240px]"
          placeholder="Key name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={createMut.isPending}
        />
        <Button size="sm" type="submit" disabled={createMut.isPending || name.trim().length === 0}>
          {createMut.isPending ? 'Creating…' : 'Create key'}
        </Button>
      </form>

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
                <code className="font-mono text-muted-foreground text-xs">{k.start ?? k.prefix ?? ''}…</code>
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
          <ProfileSection />
          <AppearanceSection />
          <NotificationsSection />
          <OperatorAgentSection />
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
