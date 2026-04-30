import { zodResolver } from '@hookform/resolvers/zod'
import { useSettingsSave } from '@modules/settings/hooks/use-settings-save'
import type { AppearanceValues } from '@modules/settings/pages/schemas'
import { appearanceSchema } from '@modules/settings/pages/schemas'
import { useForm } from 'react-hook-form'

import { useTheme } from '@/components/theme-provider'
import { THEME_OPTIONS, ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export default function AppearancePage() {
  const { theme } = useTheme()
  const currentLabel = THEME_OPTIONS.find((o) => o.value === theme)?.label ?? 'System'
  const { mutate, isPending } = useSettingsSave('appearance', appearanceSchema)

  const form = useForm<AppearanceValues>({
    resolver: zodResolver(appearanceSchema),
    defaultValues: { fontSize: 'md' },
  })

  async function onSubmit(values: AppearanceValues) {
    await mutate({ ...values, theme })
  }

  return (
    <div className="max-w-lg space-y-6 p-6">
      <div>
        <h2 className="font-semibold text-lg">Appearance</h2>
        <p className="text-muted-foreground text-sm">Customize the look and feel of the app.</p>
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm">Theme</span>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">{currentLabel}</span>
              <ThemeSwitch />
            </div>
          </div>
          <FormField
            control={form.control}
            name="fontSize"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Font size</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select size" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="sm">Small</SelectItem>
                    <SelectItem value="md">Medium</SelectItem>
                    <SelectItem value="lg">Large</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Saving…' : 'Save appearance'}
          </Button>
        </form>
      </Form>
    </div>
  )
}

import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/_app/settings/appearance')({
  component: AppearancePage,
})
