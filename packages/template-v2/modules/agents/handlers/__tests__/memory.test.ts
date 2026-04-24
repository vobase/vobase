import { beforeEach, describe, expect, it } from 'bun:test'
import { setDb } from '@modules/agents/service/agent-definitions'
import { Hono } from 'hono'

import memoryRouter from '../memory'

const CONV_ID = 'conv-mem-1'
const ORG_A = 'tenant_meridian'
const ORG_B = 'tenant_other'
const AGENT_ID = 'agt-mem-1'

const fakeConv = { id: CONV_ID, organizationId: ORG_A, assignee: `agent:${AGENT_ID}` }
const fakeAgent = { id: AGENT_ID, workingMemory: 'User prefers concise replies.' }

function makeDb(convRows: unknown[], agentRows: unknown[]) {
  let calls = 0
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (calls++ === 0 ? convRows : agentRows),
        }),
      }),
    }),
  }
}

const app = new Hono()
app.route('/conversations', memoryRouter)

const GET = (id: string, org = ORG_A) => app.request(`/conversations/${id}/working-memory?organizationId=${org}`)

describe('GET /conversations/:id/working-memory', () => {
  beforeEach(() => {
    setDb(makeDb([fakeConv], [fakeAgent]))
  })

  it('(a) returns the agent working memory for a seeded conversation', async () => {
    const res = await GET(CONV_ID)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { memory: string }
    expect(json.memory).toBe(fakeAgent.workingMemory)
  })

  it('(b) returns { memory: null } when agent has no working memory', async () => {
    setDb(makeDb([fakeConv], [{ ...fakeAgent, workingMemory: '' }]))
    const res = await GET(CONV_ID)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { memory: null }
    expect(json.memory).toBeNull()
  })

  it('(c) returns 404 when conversation belongs to a different organization', async () => {
    const res = await GET(CONV_ID, ORG_B)
    expect(res.status).toBe(404)
  })
})
