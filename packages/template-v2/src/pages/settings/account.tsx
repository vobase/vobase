import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { useSettingsSave } from '@/features/settings/api/use-settings-save'
import { accountSchema } from '@/features/settings/schemas'
import type { AccountValues } from '@/features/settings/schemas'

export default function AccountPage() {
  const { mutate, isPending } = useSettingsSave('account', accountSchema)

  const form = useForm<AccountValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: { timezone: '', language: '' },
  })

  async function onSubmit(values: AccountValues) {
    await mutate(values)
  }

  return (
    <div className="max-w-lg space-y-6 p-6">
      <div>
        <h2 className="text-lg font-semibold">Account</h2>
        <p className="text-sm text-muted-foreground">Manage your timezone and language preferences.</p>
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="timezone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Timezone</FormLabel>
                <FormControl>
                  <Input placeholder="America/New_York" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="language"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Language</FormLabel>
                <FormControl>
                  <Input placeholder="en" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Saving…' : 'Save account'}
          </Button>
        </form>
      </Form>
    </div>
  )
}
