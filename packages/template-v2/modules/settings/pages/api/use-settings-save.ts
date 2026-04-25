import { useMutation } from '@tanstack/react-query'
import type { z } from 'zod'

export async function postSettings<T>(section: string, data: T): Promise<void> {
  // biome-ignore lint/plugin/no-raw-fetch: pre-existing — settings was server/admin/ before the modules/ relocation; not yet migrated to Hono RPC
  const r = await fetch(`/api/settings/${section}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!r.ok) {
    const body = await r.json().catch(() => null)
    throw new Error((body as { error?: string } | null)?.error ?? 'Failed to save settings')
  }
}

export function useSettingsSave<T>(section: string, _schema: z.ZodType<T>) {
  const mutation = useMutation({ mutationFn: (data: T) => postSettings(section, data) })
  return {
    mutate: (v: T) => mutation.mutateAsync(v),
    isPending: mutation.isPending,
  }
}
