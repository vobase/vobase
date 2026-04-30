import { zodResolver } from '@hookform/resolvers/zod'
import { createFileRoute } from '@tanstack/react-router'
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { ContentSection } from '@/components/content-section'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { type Theme, useTheme } from '@/hooks/use-theme'
import { cn } from '@/lib/utils'

const appearanceSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
})

type AppearanceFormValues = z.infer<typeof appearanceSchema>

const themeOptions: {
  value: Theme
  label: string
  icon: typeof SunIcon
  description: string
}[] = [
  {
    value: 'light',
    label: 'Light',
    icon: SunIcon,
    description: 'Always use light mode',
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: MoonIcon,
    description: 'Always use dark mode',
  },
  {
    value: 'system',
    label: 'System',
    icon: MonitorIcon,
    description: 'Follow system preference',
  },
]

function AppearancePage() {
  const { theme, setTheme } = useTheme()

  const form = useForm<AppearanceFormValues>({
    resolver: zodResolver(appearanceSchema),
    defaultValues: {
      theme: (theme as Theme) ?? 'system',
    },
  })

  function onSubmit(data: AppearanceFormValues) {
    setTheme(data.theme)
    toast.success('Appearance updated')
  }

  return (
    <ContentSection title="Appearance" desc="Customize how the interface looks.">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">
          <FormField
            control={form.control}
            name="theme"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <RadioGroup value={field.value} onValueChange={field.onChange} className="flex gap-3">
                    {themeOptions.map(({ value, label, icon: Icon, description }) => (
                      <label
                        key={value}
                        htmlFor={`theme-${value}`}
                        className={cn(
                          'flex flex-1 cursor-pointer flex-col items-center gap-2 rounded-lg border p-4 text-sm transition-colors hover:bg-accent',
                          field.value === value
                            ? 'border-primary bg-accent text-accent-foreground'
                            : 'border-border text-muted-foreground',
                        )}
                      >
                        <RadioGroupItem id={`theme-${value}`} value={value} className="sr-only" />
                        <Icon className={cn('h-5 w-5', field.value === value ? 'text-primary' : '')} />
                        <span className={cn('font-medium', field.value === value ? 'text-foreground' : '')}>
                          {label}
                        </span>
                        <span className="text-center text-xs leading-tight text-muted-foreground">{description}</span>
                      </label>
                    ))}
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div>
            <Button type="submit">Save changes</Button>
          </div>
        </form>
      </Form>
    </ContentSection>
  )
}

export const Route = createFileRoute('/_app/settings/appearance')({
  component: AppearancePage,
})
