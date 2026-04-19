import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { useEmailOtp } from '@/features/auth/api/use-email-otp'

const schema = z.object({ email: z.email() })
type FormValues = z.infer<typeof schema>

const DEV_LOGIN_EMAIL = 'alice@meridian.test'

export default function LoginPage() {
  const navigate = useNavigate()
  const { sendOtp } = useEmailOtp()
  const [devLoginError, setDevLoginError] = useState<string | null>(null)
  const [devLoginPending, setDevLoginPending] = useState(false)

  async function handleDevLogin() {
    setDevLoginError(null)
    setDevLoginPending(true)
    try {
      const res = await fetch('/api/auth/dev-login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: DEV_LOGIN_EMAIL }),
      })
      if (!res.ok) throw new Error(`dev-login failed (${res.status})`)
      navigate({ to: '/inbox' })
    } catch (err) {
      setDevLoginError(err instanceof Error ? err.message : 'Dev login failed.')
    } finally {
      setDevLoginPending(false)
    }
  }

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
        {import.meta.env.DEV && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">dev only</span>
              <Separator className="flex-1" />
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full border-2 border-dashed border-yellow-500 bg-[repeating-linear-gradient(-45deg,transparent,transparent_8px,rgba(234,179,8,0.08)_8px,rgba(234,179,8,0.08)_16px)] text-yellow-600 hover:border-yellow-400 hover:bg-yellow-500/10 hover:text-yellow-500 dark:border-yellow-600 dark:text-yellow-500 dark:hover:border-yellow-500"
              disabled={devLoginPending}
              onClick={handleDevLogin}
            >
              {devLoginPending ? 'Signing in…' : `Sign in as ${DEV_LOGIN_EMAIL} (dev)`}
            </Button>
            {devLoginError && <p className="text-sm text-destructive">{devLoginError}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
