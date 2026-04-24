// ─── FB SDK Types ─────────────────────────────────────────────────────────────

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

// ─── Loader ───────────────────────────────────────────────────────────────────

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

// ─── Embedded Signup Flow ─────────────────────────────────────────────────────

interface WhatsAppSignupResult {
  code: string
  wabaId: string | undefined
  phoneNumberId: string | undefined
}

/**
 * Runs the WhatsApp embedded signup popup flow.
 * Resolves with the auth code + session IDs on success.
 * Rejects with a descriptive error on failure or cancellation.
 */
export function runWhatsAppEmbeddedSignup(
  appId: string,
  configId: string,
  onCancel?: (step: string) => void,
): Promise<WhatsAppSignupResult> {
  return new Promise((resolve, reject) => {
    let sessionWabaId: string | undefined
    let sessionPhoneNumberId: string | undefined

    const sessionInfoListener = (event: MessageEvent) => {
      try {
        // event.data may be a JSON string or already an object
        const raw = event.data
        const data = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
          type?: string
          event?: string
          data?: Record<string, string>
        }
        if (data.type === 'WA_EMBEDDED_SIGNUP') {
          if (data.event?.startsWith('FINISH')) {
            sessionWabaId = data.data?.waba_id
            sessionPhoneNumberId = data.data?.phone_number_id
          } else if (data.event === 'CANCEL') {
            window.removeEventListener('message', sessionInfoListener)
            const step = data.data?.current_step ?? 'unknown'
            onCancel?.(step)
            reject(new Error(`Signup cancelled at step: ${step}`))
          } else if (data.event === 'ERROR') {
            window.removeEventListener('message', sessionInfoListener)
            reject(new Error(`Signup error: ${data.data?.error_message ?? 'unknown error'}`))
          }
        }
      } catch {
        // Non-JSON messages from other sources — ignore
      }
    }

    window.addEventListener('message', sessionInfoListener)

    loadFacebookSDK(appId)
      .then(() => {
        window.FB.login(
          (response) => {
            if (response.authResponse?.code) {
              // The FINISH postMessage may arrive after FB.login fires.
              // Wait up to 3s for session info if we don't have it yet.
              const code = response.authResponse.code
              const resolveWhenReady = (attempts: number) => {
                if (sessionPhoneNumberId && sessionWabaId) {
                  window.removeEventListener('message', sessionInfoListener)
                  resolve({
                    code,
                    wabaId: sessionWabaId,
                    phoneNumberId: sessionPhoneNumberId,
                  })
                } else if (attempts <= 0) {
                  // Session info never arrived — resolve with what we have
                  // (the caller can still exchange the code)
                  window.removeEventListener('message', sessionInfoListener)
                  resolve({
                    code,
                    wabaId: sessionWabaId,
                    phoneNumberId: sessionPhoneNumberId,
                  })
                } else {
                  setTimeout(() => resolveWhenReady(attempts - 1), 300)
                }
              }
              resolveWhenReady(10)
            } else {
              window.removeEventListener('message', sessionInfoListener)
              if (response.status === 'not_authorized') {
                reject(new Error('App not authorized. Please grant permissions and try again.'))
              } else {
                // Popup closed silently — treat as cancellation
                reject(new Error('cancelled'))
              }
            }
          },
          {
            config_id: configId,
            response_type: 'code',
            override_default_response_type: true,
            extras: {
              setup: {},
              featureType: 'whatsapp_business_app_onboarding',
              sessionInfoVersion: '3',
            },
          },
        )
      })
      .catch((err: unknown) => {
        window.removeEventListener('message', sessionInfoListener)
        reject(err)
      })
  })
}
