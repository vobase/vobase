/**
 * Unit tests for the sessions and reactions service throw-proxy guards.
 *
 * Verifies that calling the free-function wrappers before installing the
 * service throws a descriptive error, and that they resolve after install.
 * The full routing flow is covered by sessions.test.ts + reactions.test.ts
 * which exercise the services against real Postgres.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import {
  __resetReactionsServiceForTests,
  installReactionsService,
  removeReaction,
  upsertReaction,
} from '@modules/messaging/service/reactions'
import {
  __resetSessionsServiceForTests,
  checkWindow,
  installSessionsService,
  seedOnInbound,
} from '@modules/messaging/service/sessions'

afterEach(() => {
  __resetSessionsServiceForTests()
  __resetReactionsServiceForTests()
})

describe('sessions throw-proxy guard', () => {
  it('seedOnInbound throws before installSessionsService', async () => {
    await expect(seedOnInbound('conv-1', 'inst-1')).rejects.toThrow('service not installed')
  })

  it('checkWindow resolves after installSessionsService', async () => {
    installSessionsService({
      seedOnInbound: async () => {},
      checkWindow: async () => ({ open: true, expiresAt: null }),
      closeWindow: async () => {},
    })
    const result = await checkWindow('conv-1')
    expect(result.open).toBe(true)
  })
})

describe('reactions throw-proxy guard', () => {
  it('upsertReaction throws before installReactionsService', async () => {
    await expect(
      upsertReaction({ messageId: 'm', channelInstanceId: 'c', fromExternal: 'f', emoji: '👍' }),
    ).rejects.toThrow('service not installed')
  })

  it('removeReaction resolves after installReactionsService', async () => {
    installReactionsService({ upsertReaction: async () => {}, removeReaction: async () => {} })
    await expect(removeReaction({ messageId: 'm', fromExternal: 'f', emoji: '👍' })).resolves.toBeUndefined()
  })
})
