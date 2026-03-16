import { useCallback, useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { AlertCircleIcon, CheckCircleIcon, Loader2Icon, MessageSquareIcon, MailIcon, DatabaseIcon, SendIcon, UnplugIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// ─── Types ────────────────────────────────────────────────────────────

interface WhatsAppStatus {
  connected: boolean
  id?: string
  phoneNumberId?: string
  wabaId?: string
  webhookReady?: boolean
}

interface IntegrationsConfig {
  metaAppId: string | null
  metaConfigId: string | null
}

// ─── FB SDK Lazy Loader ───────────────────────────────────────────────

interface FBLoginResponse {
  status: 'connected' | 'not_authorized' | string
  authResponse?: {
    code?: string
    accessToken?: string
  } | null
}

declare global {
  interface Window {
    FB: {
      init(params: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void
      login(
        callback: (response: FBLoginResponse) => void,
        params: {
          config_id: string
          response_type: string
          override_default_response_type: boolean
          extras: Record<string, unknown>
        },
      ): void
    }
    fbAsyncInit: () => void
  }
}

function loadFacebookSDK(appId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.FB) {
      resolve()
      return
    }

    const timeout = setTimeout(() => {
      reject(new Error('Facebook SDK load timeout'))
    }, 15000)

    window.fbAsyncInit = () => {
      clearTimeout(timeout)
      window.FB.init({ appId, cookie: true, xfbml: true, version: 'v22.0' })
      resolve()
    }

    const script = document.createElement('script')
    script.src = 'https://connect.facebook.net/en_US/sdk.js'
    script.async = true
    script.defer = true
    script.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('Failed to load Facebook SDK'))
    }
    document.body.appendChild(script)
  })
}

// ─── API helpers ──────────────────────────────────────────────────────

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    credentials: 'include',
  })
  return res.json() as Promise<T>
}

// ─── Page ─────────────────────────────────────────────────────────────

function IntegrationsPage() {
  const [config, setConfig] = useState<IntegrationsConfig | null>(null)
  const [waStatus, setWaStatus] = useState<WhatsAppStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testPhone, setTestPhone] = useState('')
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [cfg, status] = await Promise.all([
        fetchJson<IntegrationsConfig>('/api/integrations/config'),
        fetchJson<WhatsAppStatus>('/api/integrations/whatsapp/status'),
      ])
      setConfig(cfg)
      setWaStatus(status)
    } catch {
      setError('Failed to load integration status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Poll for webhook setup completion when connected but not ready
  useEffect(() => {
    if (!waStatus?.connected || waStatus.webhookReady) return
    const interval = setInterval(refresh, 3000)
    return () => clearInterval(interval)
  }, [waStatus?.connected, waStatus?.webhookReady, refresh])

  const handleConnect = useCallback(async () => {
    if (!config?.metaAppId || !config?.metaConfigId) return

    setConnecting(true)
    setError(null)

    // Register session info listener BEFORE calling FB.login
    // This receives phone_number_id and waba_id directly from the popup
    let sessionWabaId: string | undefined
    let sessionPhoneNumberId: string | undefined

    const sessionInfoListener = (event: MessageEvent) => {
      if (!event.origin?.endsWith('facebook.com')) return
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'WA_EMBEDDED_SIGNUP') {
          if (data.event === 'FINISH') {
            sessionWabaId = data.data.waba_id
            sessionPhoneNumberId = data.data.phone_number_id
          } else if (data.event === 'CANCEL') {
            setError(`Signup cancelled at step: ${data.data.current_step ?? 'unknown'}`)
            setConnecting(false)
          } else if (data.event === 'ERROR') {
            setError(`Signup error: ${data.data.error_message ?? 'unknown error'}`)
            setConnecting(false)
          }
        }
      } catch {
        // Non-JSON messages from other sources — ignore
      }
    }

    window.addEventListener('message', sessionInfoListener)

    try {
      await loadFacebookSDK(config.metaAppId)

      window.FB.login(
        (response) => {
          window.removeEventListener('message', sessionInfoListener)

          console.log('[WhatsApp Connect] FB.login response:', response.status, response.authResponse)

          if (response.authResponse?.code) {
            // Send code + session data to backend — code expires in ~60 seconds
            fetchJson<{ success?: boolean; error?: string }>(
              '/api/integrations/whatsapp/connect',
              {
                method: 'POST',
                body: JSON.stringify({
                  code: response.authResponse.code,
                  wabaId: sessionWabaId,
                  phoneNumberId: sessionPhoneNumberId,
                }),
              },
            ).then((result) => {
              if (result.error) {
                setError(result.error)
              }
              refresh()
            }).catch(() => {
              setError('Failed to complete WhatsApp connection')
              refresh()
            }).finally(() => {
              setConnecting(false)
            })
          } else if (response.status === 'connected') {
            // Already authorized — no new code issued. Just refresh status.
            console.log('[WhatsApp Connect] Already authorized, refreshing status')
            refresh()
            setConnecting(false)
          } else {
            setConnecting(false)
            if (response.status === 'not_authorized') {
              setError('App not authorized. Please grant permissions and try again.')
            }
            // Popup closed or cancelled — silently reset
            refresh()
          }
        },
        {
          config_id: config.metaConfigId,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            setup: {},
            featureType: 'whatsapp_business_app_onboarding',
            sessionInfoVersion: '3',
          },
        },
      )
    } catch (err) {
      window.removeEventListener('message', sessionInfoListener)
      setError(err instanceof Error ? err.message : 'Connection failed')
      setConnecting(false)
    }
  }, [config, refresh])

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true)
    setError(null)
    try {
      await fetchJson('/api/integrations/whatsapp/disconnect', { method: 'POST' })
      await refresh()
    } catch {
      setError('Failed to disconnect')
    } finally {
      setDisconnecting(false)
    }
  }, [refresh])

  const handleTest = useCallback(async () => {
    if (!testPhone.trim()) return
    setTesting(true)
    setTestResult(null)
    try {
      const result = await fetchJson<{ success: boolean; error?: string }>(
        '/api/integrations/whatsapp/test',
        {
          method: 'POST',
          body: JSON.stringify({ to: testPhone.trim() }),
        },
      )
      setTestResult(result)
    } catch {
      setTestResult({ success: false, error: 'Request failed' })
    } finally {
      setTesting(false)
    }
  }, [testPhone])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2Icon className="h-4 w-4 animate-spin" />
        Loading integrations...
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">Integrations</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Manage external service connections.
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircleIcon className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ─── Messaging ──────────────────────────────────────────── */}
      <section className="mb-6">
        <p className="mb-2 px-1 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
          Messaging
        </p>
        <Card size="sm">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10">
                <MessageSquareIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="min-w-0 flex-1">
                <CardTitle className="text-sm">WhatsApp Business</CardTitle>
                <CardDescription className="text-xs">
                  Send and receive messages via WhatsApp Cloud API
                </CardDescription>
              </div>
              <div>
                {waStatus?.connected ? (
                  <Badge variant="success">Connected</Badge>
                ) : (
                  <Badge variant="secondary">Not connected</Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!config?.metaAppId || !config?.metaConfigId ? (
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                <p className="mb-1 font-medium text-foreground">Setup required</p>
                <p>
                  Set <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">META_APP_ID</code>,{' '}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">META_APP_SECRET</code>, and{' '}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">META_CONFIG_ID</code> in your{' '}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">.env</code> file, then restart the server.
                </p>
              </div>
            ) : waStatus?.connected ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckCircleIcon className="h-3.5 w-3.5 text-emerald-500" />
                    <span>
                      Phone: {waStatus.phoneNumberId ?? 'Unknown'}
                      {waStatus.wabaId && <span className="ml-2">WABA: {waStatus.wabaId}</span>}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {waStatus.webhookReady ? (
                      <>
                        <CheckCircleIcon className="h-3.5 w-3.5 text-emerald-500" />
                        <span>Webhooks active</span>
                      </>
                    ) : (
                      <>
                        <Loader2Icon className="h-3.5 w-3.5 animate-spin text-amber-500" />
                        <span>Setting up webhooks…</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                  >
                    {disconnecting ? (
                      <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <UnplugIcon className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Disconnect
                  </Button>
                </div>

                <div className="border-t pt-3">
                  <Label htmlFor="test-phone" className="mb-1 text-xs">
                    Send test message
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="test-phone"
                      placeholder="+1234567890"
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                      className="h-8 max-w-[200px] text-xs"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleTest}
                      disabled={testing || !testPhone.trim()}
                    >
                      {testing ? (
                        <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <SendIcon className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Test
                    </Button>
                  </div>
                  {testResult && (
                    <p className={`mt-1.5 text-xs ${testResult.success ? 'text-emerald-600' : 'text-destructive'}`}>
                      {testResult.success ? 'Message sent successfully' : testResult.error ?? 'Send failed'}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                <Button size="sm" onClick={handleConnect} disabled={connecting}>
                  {connecting ? (
                    <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <MessageSquareIcon className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Connect WhatsApp
                </Button>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Already using WhatsApp Business App? Select{' '}
                  <span className="font-medium text-foreground">"Connect a WhatsApp Business App"</span>{' '}
                  in the popup to keep using the app alongside the API.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ─── Email ──────────────────────────────────────────────── */}
      <section className="mb-6">
        <p className="mb-2 px-1 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
          Email
        </p>
        <Card size="sm">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-500/10">
                <MailIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="min-w-0 flex-1">
                <CardTitle className="text-sm">Email (Resend / SMTP)</CardTitle>
                <CardDescription className="text-xs">
                  Outbound email for notifications and transactional messages
                </CardDescription>
              </div>
              <div>
                <Badge variant="secondary">Config</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Email is configured via environment variables in your{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">vobase.config.ts</code>.
              See the channels configuration documentation for setup instructions.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* ─── Knowledge Base ─────────────────────────────────────── */}
      <section>
        <p className="mb-2 px-1 text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
          Knowledge Base
        </p>
        <Card size="sm">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-orange-500/10">
                <DatabaseIcon className="h-4 w-4 text-orange-600 dark:text-orange-400" />
              </div>
              <div className="min-w-0 flex-1">
                <CardTitle className="text-sm">Google Drive / SharePoint</CardTitle>
                <CardDescription className="text-xs">
                  Connect external document sources for the knowledge base
                </CardDescription>
              </div>
              <div>
                <Badge variant="secondary">Via Sources</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Knowledge base connectors are managed from the{' '}
              <span className="font-medium text-foreground">Knowledge Base &gt; Sources</span>{' '}
              page. OAuth connections are stored securely via the integrations service.
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

export const Route = createFileRoute('/_app/settings/integrations')({
  component: IntegrationsPage,
})
