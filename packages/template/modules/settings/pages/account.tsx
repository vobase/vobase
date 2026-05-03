import { zodResolver } from '@hookform/resolvers/zod'
import { DriveBrowser } from '@modules/drive/components/drive-browser'
import { DriveProvider } from '@modules/drive/components/drive-provider'
import { useSettingsSave } from '@modules/settings/hooks/use-settings-save'
import type { AccountValues } from '@modules/settings/pages/schemas'
import { accountSchema } from '@modules/settings/pages/schemas'
import { createFileRoute } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'

import { SettingsCard, SettingsRow, SettingsSection } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCurrentUserId } from '@/hooks/use-current-user'

export default function AccountPage() {
  const { mutate, isPending } = useSettingsSave('account', accountSchema)
  const userId = useCurrentUserId()

  const { register, handleSubmit } = useForm<AccountValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: { displayName: '', email: '', timezone: '', language: '' },
  })

  async function onSubmit(values: AccountValues) {
    await mutate(values)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-6 sm:px-6 sm:py-8">
      <form onSubmit={handleSubmit(onSubmit)}>
        <SettingsSection title="Account">
          <SettingsCard>
            <SettingsRow label="Display name">
              <Input className="w-full sm:w-[280px]" placeholder="Your name" {...register('displayName')} />
            </SettingsRow>
            <SettingsRow label="Email">
              <Input
                className="w-full sm:w-[280px]"
                type="email"
                placeholder="you@example.com"
                {...register('email')}
              />
            </SettingsRow>
            <SettingsRow label="Timezone">
              <Input className="w-full sm:w-[280px]" placeholder="America/New_York" {...register('timezone')} />
            </SettingsRow>
            <SettingsRow label="Language">
              <Input className="w-full sm:w-[280px]" placeholder="en" {...register('language')} />
            </SettingsRow>
          </SettingsCard>
          <div className="flex justify-end pt-2">
            <Button size="sm" type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </SettingsSection>
      </form>

      {userId && (
        <SettingsSection title="Files" description="Personal files referenced by your agents.">
          <DriveProvider scope={{ scope: 'staff', userId }} rootLabel="Your files" initialPath="/PROFILE.md">
            <DriveBrowser />
          </DriveProvider>
        </SettingsSection>
      )}
    </div>
  )
}

export const Route = createFileRoute('/_app/settings/account')({
  component: AccountPage,
})
