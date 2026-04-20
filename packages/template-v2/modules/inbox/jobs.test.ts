import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { setDb as setJournalDb } from '@modules/agents/service/journal'
import { CUSTOMER_CHANNEL_INSTANCE_ID, MERIDIAN_TENANT_ID, SEEDED_CONTACT_ID } from '@modules/contacts/seed'
import { wakeSnoozedJobHandler } from '@modules/inbox/jobs'
import {
  reopen,
  resumeOrCreate,
  setDb as setConversationsDb,
  setScheduler,
  snooze,
} from '@modules/inbox/service/conversations'
import { setDb as setMessagesDb } from '@modules/inbox/service/messages'
import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../../tests/helpers/test-db'

let db: TestDbHandle

const noopScheduler = {
  send: async () => `job-${Math.random()}`,
  cancel: async () => undefined,
}

beforeAll(async () => {
  await resetAndSeedDb()
  db = connectTestDb()
  setConversationsDb(db.db)
  setJournalDb(db.db)
  setMessagesDb(db.db)
  setScheduler(noopScheduler)
})

afterAll(async () => {
  if (db) await db.teardown()
})

describe('wakeSnoozedJobHandler idempotency', () => {
  it('no-ops when snoozedAt does not match current row', async () => {
    const { conversation } = await resumeOrCreate(MERIDIAN_TENANT_ID, SEEDED_CONTACT_ID, CUSTOMER_CHANNEL_INSTANCE_ID)
    await reopen(conversation.id, 'test', 'staff_reopen').catch(() => undefined)
    await snooze({ conversationId: conversation.id, until: new Date(Date.now() + 3600_000), by: 'alice' })

    // stale timestamp from before snooze
    const stale = await wakeSnoozedJobHandler({
      conversationId: conversation.id,
      snoozedAt: new Date(2020, 0, 1).toISOString(),
    })
    expect(stale.woken).toBe(false)
  })
})
