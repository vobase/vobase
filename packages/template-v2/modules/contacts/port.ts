/**
 * ContactsPort implementation.
 * REAL: get, getByPhone, getByEmail, upsertByExternal, resolveStaffByExternal.
 */
import type { ContactsPort } from '@server/contracts/contacts-port'
import { contacts } from './service'

export function createContactsPort(): ContactsPort {
  return {
    async get(id) {
      return contacts.get(id)
    },
    async getByPhone(tenantId, phone) {
      return contacts.getByPhone(tenantId, phone)
    },
    async getByEmail(tenantId, email) {
      return contacts.getByEmail(tenantId, email)
    },
    async upsertByExternal(input) {
      return contacts.upsertByExternal(input)
    },
    async readWorkingMemory(id) {
      return contacts.readWorkingMemory(id)
    },
    async upsertWorkingMemorySection(id, heading, body) {
      return contacts.upsertWorkingMemorySection(id, heading, body)
    },
    async appendWorkingMemory(id, line) {
      return contacts.appendWorkingMemory(id, line)
    },
    async removeWorkingMemorySection(id, heading) {
      return contacts.removeWorkingMemorySection(id, heading)
    },
    async setSegments(id, segments) {
      return contacts.setSegments(id, segments)
    },
    async setMarketingOptOut(id, value) {
      return contacts.setMarketingOptOut(id, value)
    },
    async resolveStaffByExternal(channelInstanceId, externalIdentifier) {
      return contacts.resolveStaffByExternal(channelInstanceId, externalIdentifier)
    },
    async bindStaff(userId, channelInstanceId, externalIdentifier) {
      return contacts.bindStaff(userId, channelInstanceId, externalIdentifier)
    },
    async delete(id) {
      return contacts.remove(id)
    },
  }
}
