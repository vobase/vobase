/**
 * Unit tests for `syncSmbAppData` — the coexistence SMB App Data trigger that
 * asks Meta to start a chat-history (`sync_type: 'history'`) or contacts
 * (`sync_type: 'smb_app_state_sync'`) synchronisation after onboarding. Stubs
 * the helper's `fetchImpl` seam to assert the outbound Graph request and the
 * parsed result without hitting Meta.
 */
import { describe, expect, it } from 'bun:test'

import { type MetaOAuthConfig, MetaOAuthError, syncSmbAppData } from './meta-oauth'

const CONFIG: MetaOAuthConfig = { appId: 'app-1', appSecret: 'secret-1', apiVersion: 'v22.0' }

interface CapturedRequest {
  url: string
  method?: string
  authorization?: string
  contentType?: string
  body?: unknown
}

function stubFetch(capture: { req?: CapturedRequest }, response: Response): typeof fetch {
  const impl = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    const headers = new Headers(init?.headers)
    capture.req = {
      url: String(input),
      method: init?.method,
      authorization: headers.get('authorization') ?? undefined,
      contentType: headers.get('content-type') ?? undefined,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }
    return Promise.resolve(response)
  }
  // Bun types `typeof fetch` with a `preconnect` method; reuse the real one
  // (never invoked in tests) so the stub satisfies the type without a cast.
  return Object.assign(impl, { preconnect: globalThis.fetch.preconnect })
}

describe('syncSmbAppData', () => {
  it('issues a history sync POST to the smb_app_data endpoint and returns the request id', async () => {
    const capture: { req?: CapturedRequest } = {}
    const fetchImpl = stubFetch(
      capture,
      new Response(JSON.stringify({ messaging_product: 'whatsapp', request_id: 'req-123' }), { status: 200 }),
    )

    const result = await syncSmbAppData('PNID-1', 'history', 'token-abc', CONFIG, fetchImpl)

    expect(result.requestId).toBe('req-123')
    expect(capture.req?.url).toBe('https://graph.facebook.com/v22.0/PNID-1/smb_app_data')
    expect(capture.req?.method).toBe('POST')
    expect(capture.req?.authorization).toBe('Bearer token-abc')
    expect(capture.req?.contentType).toBe('application/json')
    expect(capture.req?.body).toEqual({ messaging_product: 'whatsapp', sync_type: 'history' })
  })

  it('throws MetaOAuthError carrying the Meta error code when the request is rejected', async () => {
    const capture: { req?: CapturedRequest } = {}
    const fetchImpl = stubFetch(
      capture,
      new Response(JSON.stringify({ error: { message: 'Unsupported post request', code: 100 } }), { status: 400 }),
    )

    let thrown: unknown
    try {
      await syncSmbAppData('PNID-1', 'history', 'token-abc', CONFIG, fetchImpl)
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(MetaOAuthError)
    if (thrown instanceof MetaOAuthError) {
      expect(thrown.kind).toBe('smb_app_data_failed')
      expect(thrown.code).toBe(100)
    }
  })

  it('passes the smb_app_state_sync sync type through for the contacts sync', async () => {
    const capture: { req?: CapturedRequest } = {}
    const fetchImpl = stubFetch(
      capture,
      new Response(JSON.stringify({ messaging_product: 'whatsapp', request_id: 'req-c' }), { status: 200 }),
    )

    const result = await syncSmbAppData('PNID-9', 'smb_app_state_sync', 'tok', CONFIG, fetchImpl)

    expect(result.requestId).toBe('req-c')
    expect(capture.req?.body).toEqual({ messaging_product: 'whatsapp', sync_type: 'smb_app_state_sync' })
  })
})
