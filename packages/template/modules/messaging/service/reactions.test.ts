import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../../../tests/helpers/test-db'
import { createReactionsService } from './reactions'

let db: TestDbHandle

const INSTANCE_ID = 'chi0cust00'
const FROM = 'whatsapp:+6591234567'
const EMOJI = '👍'
// Synthetic message id — reactions FK is cross-schema (enforced post-push only),
// so onConflictDoNothing silently drops a row with an unresolvable FK in test DBs.
// We test the service behaviour (no throw, idempotency, remove is no-op).
const SYNTHETIC_MSG_ID = 'msg-test-react'

beforeAll(async () => {
  await resetAndSeedDb()
  db = connectTestDb()
}, 60_000)

afterAll(async () => {
  if (db) await db.teardown()
})

describe('createReactionsService', () => {
  it('upsertReaction does not throw (onConflictDoNothing absorbs missing FK)', async () => {
    const svc = createReactionsService({ db: db.db })
    await expect(
      svc.upsertReaction({
        messageId: SYNTHETIC_MSG_ID,
        channelInstanceId: INSTANCE_ID,
        fromExternal: FROM,
        emoji: EMOJI,
      }),
    ).resolves.toBeUndefined()
  })

  it('upsertReaction is idempotent — duplicate call does not throw', async () => {
    const svc = createReactionsService({ db: db.db })
    const input = {
      messageId: SYNTHETIC_MSG_ID,
      channelInstanceId: INSTANCE_ID,
      fromExternal: FROM,
      emoji: EMOJI,
    }
    await svc.upsertReaction(input)
    await expect(svc.upsertReaction(input)).resolves.toBeUndefined()
  })

  it('removeReaction is a no-op when reaction does not exist', async () => {
    const svc = createReactionsService({ db: db.db })
    await expect(
      svc.removeReaction({
        messageId: 'nonexistent-msg',
        fromExternal: 'whatsapp:+999',
        emoji: '❤️',
      }),
    ).resolves.toBeUndefined()
  })
})
