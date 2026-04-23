import { zodResolver } from '@hookform/resolvers/zod'
import { useSettingsSave } from '@server/admin/settings/pages/api/use-settings-save'
import type { ApiKeysValues } from '@server/admin/settings/pages/schemas'
import { apiKeysSchema } from '@server/admin/settings/pages/schemas'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export default function ApiKeysPage() {
  const { mutate, isPending } = useSettingsSave('api-keys', apiKeysSchema)

  const form = useForm<ApiKeysValues>({
    resolver: zodResolver(apiKeysSchema),
    defaultValues: { name: '', scope: '' },
  })

  async function onSubmit(values: ApiKeysValues) {
    await mutate(values)
    form.reset()
  }

  return (
    <div className="max-w-lg space-y-6 p-6">
      <div>
        <h2 className="text-lg font-semibold">API keys</h2>
        <p className="text-sm text-muted-foreground">Manage API keys for programmatic access.</p>
      </div>
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">No API keys yet.</div>
      <div>
        <h3 className="mb-3 text-sm font-medium">Create new key</h3>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Key name</FormLabel>
                  <FormControl>
                    <Input placeholder="My API key" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="scope"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Scope</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select scope" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="read">Read</SelectItem>
                      <SelectItem value="write">Write</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Creating…' : 'Create key'}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  )
}

import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/_app/settings/api-keys')({
  component: ApiKeysPage,
})
