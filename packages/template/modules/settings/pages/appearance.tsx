import { zodResolver } from '@hookform/resolvers/zod'
import { useSettingsSave } from '@modules/settings/hooks/use-settings-save'
import type { AppearanceValues, DisplayValues } from '@modules/settings/pages/schemas'
import { appearanceSchema, displaySchema } from '@modules/settings/pages/schemas'
import { createFileRoute } from '@tanstack/react-router'
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'

import { SettingsCard, SettingsRow, SettingsSection, SettingsSegmented, SettingsToggle } from '@/components/settings'
import { useTheme } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'

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

const DENSITY_OPTIONS = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
]

const FONT_SIZE_MAP: Record<string, string> = {
  sm: '13px',
  md: '15px',
  lg: '17px',
}

export default function AppearancePage() {
  const { theme, setTheme } = useTheme()
  const { mutate: saveAppearance, isPending: savingAppearance } = useSettingsSave('appearance', appearanceSchema)
  const { mutate: saveDisplay, isPending: savingDisplay } = useSettingsSave('display', displaySchema)

  const appearanceForm = useForm<AppearanceValues>({
    resolver: zodResolver(appearanceSchema),
    defaultValues: { fontSize: 'md' },
  })

  const displayForm = useForm<DisplayValues>({
    resolver: zodResolver(displaySchema),
    defaultValues: { density: 'comfortable', showAvatars: true },
  })

  const fontSize = useWatch({ control: appearanceForm.control, name: 'fontSize' })

  useEffect(() => {
    if (fontSize) {
      document.documentElement.style.fontSize = FONT_SIZE_MAP[fontSize] ?? '15px'
    }
  }, [fontSize])

  async function onSubmitAppearance(values: AppearanceValues) {
    await saveAppearance({ ...values, theme })
  }

  async function onSubmitDisplay(values: DisplayValues) {
    await saveDisplay(values)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-6 sm:px-6 sm:py-8">
      <form onSubmit={appearanceForm.handleSubmit(onSubmitAppearance)}>
        <SettingsSection title="Appearance">
          <SettingsCard>
            <SettingsRow label="Theme">
              <SettingsSegmented
                name="theme"
                value={theme}
                onValueChange={(v) => setTheme(v as 'light' | 'dark' | 'system')}
                options={THEME_OPTIONS}
                className="w-full sm:w-[260px]"
              />
            </SettingsRow>
            <SettingsRow label="Font size">
              <SettingsSegmented
                name="fontSize"
                value={appearanceForm.watch('fontSize') ?? 'md'}
                onValueChange={(v) => appearanceForm.setValue('fontSize', v as 'sm' | 'md' | 'lg')}
                options={FONT_SIZE_OPTIONS}
                className="w-full sm:w-[260px]"
              />
            </SettingsRow>
          </SettingsCard>
          <div className="flex justify-end pt-2">
            <Button size="sm" type="submit" disabled={savingAppearance}>
              {savingAppearance ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </SettingsSection>
      </form>

      <form onSubmit={displayForm.handleSubmit(onSubmitDisplay)}>
        <SettingsSection title="Display">
          <SettingsCard>
            <SettingsRow label="Density">
              <SettingsSegmented
                name="density"
                value={displayForm.watch('density') ?? 'comfortable'}
                onValueChange={(v) => displayForm.setValue('density', v as 'comfortable' | 'compact')}
                options={DENSITY_OPTIONS}
                className="w-full sm:w-[260px]"
              />
            </SettingsRow>
            <SettingsToggle
              label="Show avatars"
              description="Display profile pictures in lists and conversations."
              checked={displayForm.watch('showAvatars') ?? true}
              onCheckedChange={(v) => displayForm.setValue('showAvatars', v)}
            />
          </SettingsCard>
          <div className="flex justify-end pt-2">
            <Button size="sm" type="submit" disabled={savingDisplay}>
              {savingDisplay ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </SettingsSection>
      </form>
    </div>
  )
}

export const Route = createFileRoute('/_app/settings/appearance')({
  component: AppearancePage,
})
