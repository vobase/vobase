/**
 * Direct-mode factory regression: envelope-encrypted credentials.
 *
 * The platform-handoff Embedded Signup pipeline persists `accessTokenEnvelope`
 * + `appSecretEnvelope` instead of plaintext. Before the matching decrypt was
 * added the factory only consulted `partial.accessToken`, so the Zod parse
 * threw on an empty string and the webhook GET handler 500'd to Meta's
 * verification challenge — breaking the per-WABA subscribe in `whatsapp:setup`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { createWhatsAppAdapterFromConfig } from './factory'
import { buildEncryptedAccessTokenField } from './instance-config'

const TEST_KEK_SECRET = 'test-kek-secret-32-chars-min-padding'

describe('createWhatsAppAdapterFromConfig (direct mode, envelope-encrypted)', () => {
  let prevAuthSecret: string | undefined
  let prevAccessToken: string | undefined
  let prevAppSecret: string | undefined

  beforeEach(() => {
    prevAuthSecret = process.env.BETTER_AUTH_SECRET
    prevAccessToken = process.env.META_WA_ACCESS_TOKEN
    prevAppSecret = process.env.META_WA_APP_SECRET
    process.env.BETTER_AUTH_SECRET = TEST_KEK_SECRET
    delete process.env.META_WA_ACCESS_TOKEN
    delete process.env.META_WA_APP_SECRET
  })

  afterEach(() => {
    if (prevAuthSecret === undefined) delete process.env.BETTER_AUTH_SECRET
    else process.env.BETTER_AUTH_SECRET = prevAuthSecret
    if (prevAccessToken === undefined) delete process.env.META_WA_ACCESS_TOKEN
    else process.env.META_WA_ACCESS_TOKEN = prevAccessToken
    if (prevAppSecret === undefined) delete process.env.META_WA_APP_SECRET
    else process.env.META_WA_APP_SECRET = prevAppSecret
  })

  it('constructs an adapter when accessToken + appSecret live only in envelopes', async () => {
    const config = {
      mode: 'self',
      coexistence: true,
      phoneNumberId: 'pnid-test',
      wabaId: 'waba-test',
      appId: 'app-test',
      apiVersion: 'v22.0',
      webhookVerifyToken: 'verify-test',
      accessTokenEnvelope: buildEncryptedAccessTokenField('plaintext-token-XYZ'),
      appSecretEnvelope: buildEncryptedAccessTokenField('plaintext-secret-ABC'),
    }

    const adapter = await createWhatsAppAdapterFromConfig(config, 'inst-test')
    expect(adapter).toBeDefined()
    expect(typeof adapter.handleWebhookChallenge).toBe('function')
  })

  it('webhook challenge succeeds with the configured verify token', async () => {
    const config = {
      mode: 'self',
      coexistence: true,
      phoneNumberId: 'pnid-test',
      wabaId: 'waba-test',
      webhookVerifyToken: 'verify-test',
      accessTokenEnvelope: buildEncryptedAccessTokenField('plaintext-token-XYZ'),
      appSecretEnvelope: buildEncryptedAccessTokenField('plaintext-secret-ABC'),
    }

    const adapter = await createWhatsAppAdapterFromConfig(config, 'inst-test')
    const req = new Request(
      'https://example.test/api/channels/webhook/whatsapp/inst-test?hub.mode=subscribe&hub.verify_token=verify-test&hub.challenge=challenge-42',
    )
    const res = adapter.handleWebhookChallenge?.(req)
    expect(res).toBeDefined()
    expect(res?.status).toBe(200)
    expect(await res?.text()).toBe('challenge-42')
  })

  it('plaintext path still works (back-compat with dev/seeded rows)', async () => {
    const config = {
      mode: 'self',
      coexistence: true,
      phoneNumberId: 'pnid-test',
      wabaId: 'waba-test',
      accessToken: 'plain-token',
      appSecret: 'plain-secret',
      webhookVerifyToken: 'verify-test',
    }

    const adapter = await createWhatsAppAdapterFromConfig(config, 'inst-test')
    expect(adapter).toBeDefined()
  })
})
