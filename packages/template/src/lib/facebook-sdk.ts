/**
 * Facebook JavaScript SDK loader + WhatsApp Embedded Signup launcher.
 *
 * The SDK is loaded on demand (idempotent) and the listener is registered
 * BEFORE `FB.login` so the postMessage `WA_EMBEDDED_SIGNUP` events from the
 * popup window are received deterministically (per `embedded-signup.md`).
 *
 * Two flow variants:
 *   - `mode: 'cloud'`        — default Cloud-API onboarding. New WABA + new number.
 *   - `mode: 'coexistence'`  — existing WhatsApp Business App user. Adds
 *     `extras.featureType = 'whatsapp_business_app_onboarding'` per the
 *     coexistence reference.
 *
 * The launcher resolves `{ code, phoneNumberId, wabaId, sessionData }` on the
 * `FINISH` postMessage; rejects with `WhatsAppSignupError` on `CANCEL` /
 * `ERROR` / popup dismiss.
 */

declare global {
  interface Window {
    fbAsyncInit?: () => void
    FB?: FacebookSdk
  }
}

interface FacebookLoginExtras {
  sessionInfoVersion?: string
  featureType?: string
  setup?: Record<string, unknown>
  features?: Array<{ name: string }>
}

interface FacebookLoginOptions {
  config_id: string
  response_type?: 'code'
  override_default_response_type?: boolean
  extras?: FacebookLoginExtras
}

interface FacebookLoginAuthResponse {
  code?: string
  accessToken?: string
}

interface FacebookLoginResponse {
  status: 'connected' | 'not_authorized' | 'unknown' | string
  authResponse?: FacebookLoginAuthResponse | null
}

interface FacebookSdk {
  init(opts: { appId: string; cookie?: boolean; xfbml?: boolean; version: string }): void
  login(callback: (response: FacebookLoginResponse) => void, options: FacebookLoginOptions): void
}

let sdkPromise: Promise<FacebookSdk> | null = null

export function loadFacebookSDK(appId: string, version: string = 'v22.0'): Promise<FacebookSdk> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('facebook-sdk: window is not defined (SSR)'))
  }
  if (sdkPromise) return sdkPromise

  sdkPromise = new Promise((resolve, reject) => {
    if (window.FB) {
      window.FB.init({ appId, cookie: true, xfbml: true, version })
      resolve(window.FB)
      return
    }

    window.fbAsyncInit = () => {
      if (!window.FB) {
        reject(new Error('facebook-sdk: FB global missing after fbAsyncInit'))
        return
      }
      window.FB.init({ appId, cookie: true, xfbml: true, version })
      resolve(window.FB)
    }

    const existing = document.getElementById('facebook-jssdk')
    if (existing) return
    const script = document.createElement('script')
    script.id = 'facebook-jssdk'
    script.async = true
    script.defer = true
    script.src = 'https://connect.facebook.net/en_US/sdk.js'
    script.onerror = () => reject(new Error('facebook-sdk: SDK_LOAD_ERROR'))
    const first = document.getElementsByTagName('script')[0]
    first?.parentNode?.insertBefore(script, first)
  })

  return sdkPromise
}

export interface RunWhatsAppEmbeddedSignupArgs {
  appId: string
  configId: string
  mode: 'cloud' | 'coexistence'
  apiVersion?: string
}

export interface WhatsAppSignupResult {
  code: string
  phoneNumberId: string
  wabaId: string
  sessionData: Record<string, unknown>
}

export class WhatsAppSignupError extends Error {
  constructor(
    public readonly kind: 'cancel' | 'error' | 'sdk_load' | 'no_code' | 'login_failed',
    message: string,
    public readonly currentStep?: string,
  ) {
    super(`whatsapp-signup: ${kind}: ${message}`)
    this.name = 'WhatsAppSignupError'
  }
}

export async function runWhatsAppEmbeddedSignup(args: RunWhatsAppEmbeddedSignupArgs): Promise<WhatsAppSignupResult> {
  let fb: FacebookSdk
  try {
    fb = await loadFacebookSDK(args.appId, args.apiVersion ?? 'v22.0')
  } catch (err) {
    throw new WhatsAppSignupError('sdk_load', (err as Error).message)
  }

  return new Promise<WhatsAppSignupResult>((resolve, reject) => {
    let sessionData: { phone_number_id?: string; waba_id?: string; [k: string]: unknown } | null = null
    let settled = false

    const finish = (result: WhatsAppSignupResult | WhatsAppSignupError) => {
      if (settled) return
      settled = true
      window.removeEventListener('message', listener)
      if (result instanceof WhatsAppSignupError) reject(result)
      else resolve(result)
    }

    const listener = (event: MessageEvent) => {
      // The popup posts from facebook.com origins. Drop everything else to
      // avoid mishandling unrelated cross-frame chatter (extensions, devtools).
      if (typeof event.origin !== 'string' || !event.origin.endsWith('facebook.com')) return
      if (typeof event.data !== 'string') return
      try {
        const data = JSON.parse(event.data) as {
          type?: string
          event?: 'FINISH' | 'CANCEL' | 'ERROR'
          data?: Record<string, unknown>
        }
        if (data.type !== 'WA_EMBEDDED_SIGNUP') return
        if (data.event === 'FINISH') {
          sessionData = (data.data ?? {}) as typeof sessionData
        } else if (data.event === 'CANCEL') {
          finish(
            new WhatsAppSignupError(
              'cancel',
              'user cancelled',
              typeof data.data?.current_step === 'string' ? data.data.current_step : undefined,
            ),
          )
        } else if (data.event === 'ERROR') {
          finish(
            new WhatsAppSignupError(
              'error',
              typeof data.data?.error_message === 'string' ? data.data.error_message : 'unknown error',
            ),
          )
        }
      } catch {
        // Non-JSON message — ignore.
      }
    }

    window.addEventListener('message', listener)

    const extras: FacebookLoginExtras = {
      sessionInfoVersion: '3',
      setup: {},
    }
    if (args.mode === 'coexistence') {
      extras.featureType = 'whatsapp_business_app_onboarding'
    }

    fb.login(
      (response) => {
        if (response.status !== 'connected' || !response.authResponse?.code) {
          finish(
            new WhatsAppSignupError(
              response.status === 'not_authorized' ? 'login_failed' : 'cancel',
              `FB.login status=${response.status}`,
            ),
          )
          return
        }
        const code = response.authResponse.code
        if (sessionData?.phone_number_id && sessionData.waba_id) {
          finish({
            code,
            phoneNumberId: sessionData.phone_number_id,
            wabaId: sessionData.waba_id,
            sessionData,
          })
          return
        }
        const start = Date.now()
        const tick = () => {
          if (sessionData?.phone_number_id && sessionData.waba_id) {
            finish({
              code,
              phoneNumberId: sessionData.phone_number_id,
              wabaId: sessionData.waba_id,
              sessionData,
            })
            return
          }
          if (Date.now() - start > 5000) {
            finish(new WhatsAppSignupError('no_code', 'FINISH postMessage missing phone/waba ids'))
            return
          }
          setTimeout(tick, 100)
        }
        tick()
      },
      {
        config_id: args.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras,
      },
    )
  })
}
