/**
 * WhatsApp Embedded Signup launcher.
 *
 * Two CTAs by product decision (locked 2026-05-04):
 *   - PRIMARY:   "Connect existing WhatsApp Business App" (coexistence mode).
 *                Singapore SMEs are overwhelmingly already on the Business
 *                App; coexistence is the lowest-friction onramp.
 *   - SECONDARY: "Use a new number (Cloud API)" — for new businesses or those
 *                migrating off the Business App.
 *
 * Flow:
 *   1. POST /api/channels/whatsapp/signup/start → { nonce, appId, configIds }.
 *   2. runWhatsAppEmbeddedSignup(...) → { code, phoneNumberId, wabaId }.
 *   3. POST /api/channels/whatsapp/signup/exchange { code, phoneNumberId,
 *      wabaId, mode, nonce }.
 *   4. On success: invoke `onConnected(instanceId)` for the parent admin page
 *      to navigate or refresh. Slice F wires the post-success route.
 *   5. On failure: render <Alert>; clicking retry calls /start again for a
 *      fresh nonce (the previous one was consumed).
 */
import { useMutation } from '@tanstack/react-query'
import { AlertCircle, MessageCircle, Phone } from 'lucide-react'
import { useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { channelsClient } from '@/lib/api-client'
import { runWhatsAppEmbeddedSignup, WhatsAppSignupError } from '@/lib/facebook-sdk'

interface SignupExchangeResponse {
  instanceId: string
  displayPhoneNumber: string | null
  coexistence: boolean
}

async function runSignupFlow(mode: 'cloud' | 'coexistence'): Promise<SignupExchangeResponse> {
  const startRes = await channelsClient.whatsapp.signup.start.$post()
  if (!startRes.ok) {
    throw new Error(`signup/start ${startRes.status}`)
  }
  const start = (await startRes.json()) as {
    nonce: string
    expiresAt: string
    appId: string | null
    apiVersion: string
    configIdCloud: string | null
    configIdCoexistence: string | null
  }
  const configId = mode === 'coexistence' ? start.configIdCoexistence : start.configIdCloud
  if (!start.appId || !configId) {
    throw new Error(
      'WhatsApp Embedded Signup is not configured on this instance — set META_APP_ID and the appropriate META_APP_CONFIG_ID_* env vars',
    )
  }

  const result = await runWhatsAppEmbeddedSignup({
    appId: start.appId,
    configId,
    mode,
    apiVersion: start.apiVersion,
  })

  const exchangeRes = await channelsClient.whatsapp.signup.exchange.$post({
    json: {
      code: result.code,
      phoneNumberId: result.phoneNumberId,
      wabaId: result.wabaId,
      mode,
      nonce: start.nonce,
    },
  })
  if (!exchangeRes.ok) {
    const text = await exchangeRes.text().catch(() => '')
    throw new Error(text || `signup/exchange ${exchangeRes.status}`)
  }
  return (await exchangeRes.json()) as SignupExchangeResponse
}

interface WhatsAppSignupButtonProps {
  /** Optional callback fired with the new instance id on success. */
  onConnected?: (instanceId: string) => void
  /**
   * `hero` (default) — full layout with large primary, helper text, and outline secondary.
   * `compact` — primary lg button only, secondary rendered as a smaller link-style affordance below.
   */
  variant?: 'hero' | 'compact'
}

export function WhatsAppSignupButton({ onConnected, variant = 'hero' }: WhatsAppSignupButtonProps) {
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (mode: 'cloud' | 'coexistence') => runSignupFlow(mode),
    onSuccess: (data) => {
      setError(null)
      onConnected?.(data.instanceId)
    },
    onError: (err: unknown) => {
      if (err instanceof WhatsAppSignupError && err.kind === 'cancel') {
        // User dismissed the popup — not an error worth surfacing.
        setError(null)
        return
      }
      setError(err instanceof Error ? err.message : 'WhatsApp connect failed')
    },
  })

  const launching = mutation.isPending

  if (variant === 'compact') {
    return (
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          size="lg"
          className="gap-2"
          disabled={launching}
          onClick={() => mutation.mutate('coexistence')}
        >
          <MessageCircle className="size-4" />
          {launching ? 'Connecting…' : 'Connect existing WhatsApp Business App'}
        </Button>
        <button
          type="button"
          className="text-left text-muted-foreground text-xs underline-offset-4 hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-50"
          disabled={launching}
          onClick={() => mutation.mutate('cloud')}
        >
          Use a new number (Cloud API) instead
        </button>
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Connect failed</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{error}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setError(null)
                  mutation.mutate('coexistence')
                }}
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        size="lg"
        className="gap-2"
        disabled={launching}
        onClick={() => mutation.mutate('coexistence')}
      >
        <MessageCircle className="size-4" />
        {launching ? 'Connecting…' : 'Connect existing WhatsApp Business App'}
      </Button>
      <p className="text-muted-foreground text-xs">
        Already chatting on WhatsApp? Keep using your phone — we'll mirror messages here.
      </p>
      <div className="mt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={launching}
          onClick={() => mutation.mutate('cloud')}
        >
          <Phone className="size-4" />
          Use a new number (Cloud API)
        </Button>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Connect failed</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setError(null)
                mutation.mutate('coexistence')
              }}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
