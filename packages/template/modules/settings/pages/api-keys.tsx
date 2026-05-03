import { zodResolver } from '@hookform/resolvers/zod'
import { useSettingsSave } from '@modules/settings/hooks/use-settings-save'
import type { ApiKeysValues } from '@modules/settings/pages/schemas'
import { apiKeysSchema } from '@modules/settings/pages/schemas'
import { createFileRoute } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'

import { SettingsCard, SettingsRow, SettingsSection } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export default function ApiKeysPage() {
  const { mutate, isPending } = useSettingsSave('api-keys', apiKeysSchema)

  const { register, handleSubmit, setValue, watch, reset } = useForm<ApiKeysValues>({
    resolver: zodResolver(apiKeysSchema),
    defaultValues: { name: '', scope: '' },
  })

  async function onSubmit(values: ApiKeysValues) {
    await mutate(values)
    reset()
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-6 sm:px-6 sm:py-8">
      <SettingsSection title="API Keys">
        <SettingsCard>
          <SettingsRow label="No API keys yet." className="text-muted-foreground" />
        </SettingsCard>
      </SettingsSection>

      <form onSubmit={handleSubmit(onSubmit)}>
        <SettingsSection title="Create new key">
          <SettingsCard>
            <SettingsRow label="Key name">
              <Input className="w-full sm:w-[280px]" placeholder="My API key" {...register('name')} />
            </SettingsRow>
            <SettingsRow label="Scope">
              <Select value={watch('scope') ?? ''} onValueChange={(v) => setValue('scope', v)}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Select scope" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="read">Read</SelectItem>
                  <SelectItem value="write">Write</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>
          </SettingsCard>
          <div className="flex justify-end pt-2">
            <Button size="sm" type="submit" disabled={isPending}>
              {isPending ? 'Creating…' : 'Create key'}
            </Button>
          </div>
        </SettingsSection>
      </form>
    </div>
  )
}

export const Route = createFileRoute('/_app/settings/api-keys')({
  component: ApiKeysPage,
})
