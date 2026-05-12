import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../../../tests/helpers/test-db'
import { createReactionsService } from './reactions'

let db: TestDbHandle

const INSTANCE_ID = 'chi0cust00'
const FROM = 'whatsapp:+6591234567'
const EMOJI = '👍'
// Seeded customer-channel WhatsApp message — message_reactions.message_id
// has a real FK to messaging.messages, so the test must reference an
// existing message row.
const SEEDED_MSG_ID = 'msg0priywa1'

beforeAll(async () => {
  await resetAndSeedDb()
  db = connectTestDb()
}, 60_000)

afterAll(async () => {
  if (db) await db.teardown()
})

describe('createReactionsService', () => {
  it('upsertReaction inserts a reaction row for a real message', async () => {
    const svc = createReactionsService({ db: db.db })
    await expect(
      svc.upsertReaction({
        messageId: SEEDED_MSG_ID,
        channelInstanceId: INSTANCE_ID,
        fromExternal: FROM,
        emoji: EMOJI,
      }),
    ).resolves.toBeUndefined()
  })

  it('upsertReaction is idempotent — duplicate call does not throw (PK conflict absorbed)', async () => {
    const svc = createReactionsService({ db: db.db })
    const input = {
      messageId: SEEDED_MSG_ID,
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
