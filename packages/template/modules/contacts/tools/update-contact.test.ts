import { afterAll, describe, expect, it } from 'bun:test'
import {
  __resetContactsServiceForTests,
  type ContactsService,
  installContactsService,
} from '@modules/contacts/service/contacts'
import type { ToolContext } from '@vobase/core'

import { updateContactTool } from './update-contact'

const ORG_ID = 'org0test0'
const AGENT_ID = 'agt0op0001'

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    organizationId: ORG_ID,
    conversationId: 'conv1',
    wakeId: 'wake1',
    agentId: AGENT_ID,
    turnIndex: 0,
    toolCallId: 'call1',
    ...overrides,
  }
}

afterAll(() => {
  __resetContactsServiceForTests()
})

describe('updateContactTool', () => {
  it('rejects empty contactId', async () => {
    installContactsService({} as ContactsService)
    const result = await updateContactTool.execute({ contactId: '', patch: {} } as never, ctx())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('VALIDATION_ERROR')
  })

  it('forwards patch to contacts.update and returns the id', async () => {
    let receivedPatch: unknown = null
    installContactsService({
      update: (id: string, patch: unknown) => {
        receivedPatch = patch
        return Promise.resolve({ id, displayName: 'New', phone: null, email: null } as never)
      },
    } as unknown as ContactsService)
    const result = await updateContactTool.execute(
      { contactId: 'cont1', patch: { displayName: 'New', segments: ['vip'] } },
      ctx(),
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content.id).toBe('cont1')
    expect(receivedPatch).toEqual({ displayName: 'New', segments: ['vip'] })
  })

  it('returns UPDATE_ERROR on service rejection', async () => {
    installContactsService({
      update: () => Promise.reject(new Error('db down')),
    } as unknown as ContactsService)
    const result = await updateContactTool.execute({ contactId: 'cont1', patch: {} }, ctx())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorCode).toBe('UPDATE_ERROR')
      expect(result.error).toContain('db down')
    }
  })
})
