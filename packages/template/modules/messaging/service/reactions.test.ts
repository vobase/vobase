import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { MERIDIAN_ORG_ID } from '@modules/contacts/seed'
import { messages } from '@modules/messaging/schema'
import { SEEDED_CONV_ID } from '@modules/messaging/seed'
import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../../../tests/helpers/test-db'
import { createReactionsService } from './reactions'

let db: TestDbHandle

const INSTANCE_ID = 'chi0cust00'
const FROM = 'whatsapp:+6591234567'
const EMOJI = '👍'
// Real message id; the reactions FK is same-schema (messaging.message_reactions
// → messaging.messages.id) and enforced by drizzle's normal push, so upserts
// against a missing message_id raise 23503 regardless of ON CONFLICT. We
// insert a synthetic message under the seeded conversation to test the
// service's idempotency on a valid FK target.
const TEST_MSG_ID = 'msg-test-react'

beforeAll(async () => {
  await resetAndSeedDb()
  db = connectTestDb()

  await db.db
    .insert(messages)
    .values({
      id: TEST_MSG_ID,
      conversationId: SEEDED_CONV_ID,
      organizationId: MERIDIAN_ORG_ID,
      role: 'customer',
      kind: 'text',
      content: { text: 'reactions-test fixture' },
    })
    .onConflictDoNothing()
}, 60_000)

afterAll(async () => {
  if (db) await db.teardown()
})

describe('createReactionsService', () => {
  it('upsertReaction succeeds against a real message_id', async () => {
    const svc = createReactionsService({ db: db.db })
    await expect(
      svc.upsertReaction({
        messageId: TEST_MSG_ID,
        channelInstanceId: INSTANCE_ID,
        fromExternal: FROM,
        emoji: EMOJI,
      }),
    ).resolves.toBeUndefined()
  })

  it('upsertReaction is idempotent — duplicate call does not throw', async () => {
    const svc = createReactionsService({ db: db.db })
    const input = {
      messageId: TEST_MSG_ID,
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
