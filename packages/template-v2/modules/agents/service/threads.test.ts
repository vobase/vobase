import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { sql } from 'drizzle-orm'

import { connectTestDb, resetAndSeedDb } from '~/tests/helpers/test-db'
import { __resetThreadsServiceForTests, createThreadsService, installThreadsService, threads } from './threads'

let handle: ReturnType<typeof connectTestDb>
let db: ReturnType<typeof connectTestDb>['db']

beforeAll(async () => {
  await resetAndSeedDb()
  handle = connectTestDb()
  db = handle.db
})

beforeEach(async () => {
  __resetThreadsServiceForTests()
  await db.execute(sql`TRUNCATE agents.agent_thread_messages CASCADE`)
  await db.execute(sql`TRUNCATE agents.agent_threads CASCADE`)
  installThreadsService(createThreadsService({ db: db as unknown as Parameters<typeof createThreadsService>[0]['db'] }))
})

afterEach(() => {
  __resetThreadsServiceForTests()
})

async function ensureAgent(): Promise<string> {
  const agentId = 'agent-test'
  await db.execute(
    sql`INSERT INTO agents.agent_definitions (id, organization_id, name, role) VALUES (${agentId}, 'org-1', 'tester', 'operator') ON CONFLICT (id) DO UPDATE SET role = 'operator'`,
  )
  return agentId
}

describe('threadsService', () => {
  it('creates a thread + first message in a single transaction', async () => {
    const agentId = await ensureAgent()
    const { threadId } = await threads.createThread({
      organizationId: 'org-1',
      agentId,
      createdBy: 'user-1',
      title: 'Triage outreach',
      firstMessage: { role: 'user', content: 'kick off triage' },
    })
    const rows = await db.execute(
      sql`SELECT id, status, title, last_turn_at FROM agents.agent_threads WHERE id = ${threadId}`,
    )
    expect(rows.length).toBe(1)
    const messages = await db.execute(
      sql`SELECT seq, role, content FROM agents.agent_thread_messages WHERE thread_id = ${threadId}`,
    )
    expect(messages.length).toBe(1)
    expect(messages[0]?.seq).toBe(1)
    expect(messages[0]?.role).toBe('user')
  })

  it('appendMessage increments seq monotonically and updates lastTurnAt', async () => {
    const agentId = await ensureAgent()
    const { threadId } = await threads.createThread({ organizationId: 'org-1', agentId, createdBy: 'u' })
    const a = await threads.appendMessage({ threadId, role: 'user', content: 'first' })
    const b = await threads.appendMessage({ threadId, role: 'assistant', content: 'second' })
    expect(a.seq).toBe(1)
    expect(b.seq).toBe(2)
    const head = await db.execute(sql`SELECT last_turn_at FROM agents.agent_threads WHERE id = ${threadId}`)
    expect(head[0]?.last_turn_at).not.toBeNull()
  })

  it('closeThread flips status', async () => {
    const agentId = await ensureAgent()
    const { threadId } = await threads.createThread({ organizationId: 'org-1', agentId, createdBy: 'u' })
    await threads.closeThread({ threadId })
    const rows = await db.execute(sql`SELECT status FROM agents.agent_threads WHERE id = ${threadId}`)
    expect(rows[0]?.status).toBe('closed')
  })

  it('listForCreator orders by lastTurnAt desc, falling back to createdAt', async () => {
    const agentId = await ensureAgent()
    const t1 = await threads.createThread({ organizationId: 'org-1', agentId, createdBy: 'u' })
    const t2 = await threads.createThread({ organizationId: 'org-1', agentId, createdBy: 'u' })
    await threads.appendMessage({ threadId: t1.threadId, role: 'user', content: 'bumped' })
    const list = await threads.listForCreator({ organizationId: 'org-1', createdBy: 'u' })
    expect(list[0]?.id).toBe(t1.threadId)
    expect(list[1]?.id).toBe(t2.threadId)
  })

  it('emits realtime notifications for create / append / close', async () => {
    const agentId = await ensureAgent()
    const events: Array<{ table: string; action: string | undefined }> = []
    installThreadsService(
      createThreadsService({
        db: db as unknown as Parameters<typeof createThreadsService>[0]['db'],
        notify: (p) => {
          events.push({ table: p.table, action: p.action })
        },
      }),
    )
    const { threadId } = await threads.createThread({ organizationId: 'org-1', agentId, createdBy: 'u' })
    await threads.appendMessage({ threadId, role: 'user', content: 'x' })
    await threads.closeThread({ threadId })
    expect(events).toEqual([
      { table: 'agent_threads', action: 'insert' },
      { table: 'agent_thread_messages', action: 'insert' },
      { table: 'agent_threads', action: 'update' },
    ])
  })
})
