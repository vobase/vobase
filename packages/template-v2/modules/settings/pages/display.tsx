import { zodResolver } from '@hookform/resolvers/zod'
import { useSettingsSave } from '@modules/settings/pages/api/use-settings-save'
import type { DisplayValues } from '@modules/settings/pages/schemas'
import { displaySchema } from '@modules/settings/pages/schemas'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export default function DisplayPage() {
  const { mutate, isPending } = useSettingsSave('display', displaySchema)

  const form = useForm<DisplayValues>({
    resolver: zodResolver(displaySchema),
    defaultValues: { density: 'comfortable', showAvatars: true },
  })

  async function onSubmit(values: DisplayValues) {
    await mutate(values)
  }

  return (
    <div className="max-w-lg space-y-6 p-6">
      <div>
        <h2 className="text-lg font-semibold">Display</h2>
        <p className="text-sm text-muted-foreground">Adjust density and visual preferences.</p>
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="density"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Density</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select density" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="comfortable">Comfortable</SelectItem>
                    <SelectItem value="compact">Compact</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="showAvatars"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                <FormLabel className="cursor-pointer">Show avatars</FormLabel>
                <FormControl>
                  <input
                    type="checkbox"
                    checked={field.value ?? false}
                    onChange={(e) => field.onChange(e.target.checked)}
                    className="h-4 w-4"
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Saving…' : 'Save display'}
          </Button>
        </form>
      </Form>
    </div>
  )
}

import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/_app/settings/display')({
  component: DisplayPage,
})
