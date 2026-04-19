import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { useEmailOtp } from '@/features/auth/api/use-email-otp'

const schema = z.object({ email: z.email() })
type FormValues = z.infer<typeof schema>

export default function LoginPage() {
  const navigate = useNavigate()
  const { sendOtp } = useEmailOtp()

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  })

  function onSubmit({ email }: FormValues) {
    sendOtp.mutate({ email }, { onSuccess: () => navigate({ to: '/auth/pending', search: { email } }) })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 px-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted-foreground">Enter your email to receive a one-time code.</p>
        </div>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="you@example.com" autoComplete="email" autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {sendOtp.error && (
              <p className="text-sm text-destructive">
                {sendOtp.error instanceof Error ? sendOtp.error.message : 'Failed to send code. Try again.'}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={sendOtp.isPending}>
              {sendOtp.isPending ? 'Sending…' : 'Send code'}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  )
}
