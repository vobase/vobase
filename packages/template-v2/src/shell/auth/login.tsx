import { zodResolver } from '@hookform/resolvers/zod'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { useEmailOtp } from '@/shell/auth/use-email-otp'

const schema = z.object({ email: z.email() })
type FormValues = z.infer<typeof schema>

const DEV_LOGIN_EMAIL = 'alice@meridian.test'

const platformUrl = import.meta.env.VITE_PLATFORM_URL
const platformTenantSlug = import.meta.env.VITE_PLATFORM_TENANT_SLUG

export function LoginPage() {
  const navigate = useNavigate()
  const { sendOtp } = useEmailOtp()
  const [devLoginError, setDevLoginError] = useState<string | null>(null)
  const [devLoginPending, setDevLoginPending] = useState(false)

  const showPlatformOAuth = Boolean(platformUrl && platformTenantSlug)
  function redirectToPlatformOAuth(provider: 'google' | 'microsoft') {
    // Validate platformUrl before constructing the redirect.
    // Allow http://localhost for dev; require https:// in all other cases.
    const isLocalhost = typeof platformUrl === 'string' && /^http:\/\/localhost(:\d+)?/.test(platformUrl)
    const isHttps = typeof platformUrl === 'string' && platformUrl.startsWith('https://')
    if (!isHttps && !isLocalhost) {
      console.error('[auth] platformUrl must start with https:// (or http://localhost for dev):', platformUrl)
      return
    }
    try {
      const url = new URL(`/api/oauth-proxy/oauth/${provider}/initiate`, platformUrl)
      url.searchParams.set('tenant', platformTenantSlug ?? '')
      url.searchParams.set('redirect', window.location.origin)
      window.location.href = url.toString()
    } catch (err) {
      console.error('[auth] Failed to construct OAuth redirect URL:', err)
    }
  }

  async function handleDevLogin() {
    setDevLoginError(null)
    setDevLoginPending(true)
    try {
      // biome-ignore lint/plugin/no-raw-fetch: dev-only OTP-bypass endpoint not in handler tree; typed RPC unavailable
      const res = await fetch('/api/auth/dev-login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: DEV_LOGIN_EMAIL }),
      })
      if (!res.ok) throw new Error(`dev-login failed (${res.status})`)
      navigate({ to: '/messaging' })
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
          <h1 className="font-semibold text-xl tracking-tight">Sign in</h1>
          <p className="text-muted-foreground text-sm">Enter your email to receive a one-time code.</p>
        </div>
        {showPlatformOAuth && (
          <div className="space-y-3">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => redirectToPlatformOAuth('google')}
            >
              <svg className="mr-2 size-4" viewBox="0 0 24 24" role="img" aria-label="Google">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Sign in with Google
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => redirectToPlatformOAuth('microsoft')}
            >
              <svg className="mr-2 size-4" viewBox="0 0 21 21" role="img" aria-label="Microsoft">
                <rect x="1" y="1" width="9" height="9" fill="#F25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
                <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
                <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
              </svg>
              Sign in with Microsoft
            </Button>
            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-muted-foreground text-xs">or</span>
              <Separator className="flex-1" />
            </div>
          </div>
        )}
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
              <p className="text-destructive text-sm">
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
              <span className="text-muted-foreground text-xs">dev only</span>
              <Separator className="flex-1" />
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full border-2 border-warning border-dashed bg-[repeating-linear-gradient(-45deg,transparent,transparent_8px,rgba(234,179,8,0.08)_8px,rgba(234,179,8,0.08)_16px)] text-warning hover:border-warning/80 hover:bg-warning/10 hover:text-warning/90"
              disabled={devLoginPending}
              onClick={handleDevLogin}
            >
              {devLoginPending ? 'Signing in…' : `Sign in as ${DEV_LOGIN_EMAIL} (dev)`}
            </Button>
            {devLoginError && <p className="text-destructive text-sm">{devLoginError}</p>}
          </div>
        )}
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_auth/auth/login')({
  component: LoginPage,
})
