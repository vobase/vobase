import { useMutation } from '@tanstack/react-query'
import type { z } from 'zod'

import { settingsClient } from '@/lib/api-client'

type SettingsSection = 'profile' | 'notifications'

export async function postSettings<T>(section: SettingsSection, data: T): Promise<void> {
  const arg = { json: data as never }
  const r =
    section === 'profile' ? await settingsClient.profile.$post(arg) : await settingsClient.notifications.$post(arg)
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? 'Failed to save settings')
  }
}

export function useSettingsSave<T>(section: SettingsSection, _schema: z.ZodType<T>) {
  const mutation = useMutation({ mutationFn: (data: T) => postSettings(section, data) })
  return {
    mutate: (v: T) => mutation.mutateAsync(v),
    isPending: mutation.isPending,
  }
}
