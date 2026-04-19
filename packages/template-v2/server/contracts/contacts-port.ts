/**
 * ContactsPort — identity + staff bindings.
 */

import type { Contact, StaffBinding } from './domain-types'

export interface UpsertByExternalInput {
  tenantId: string
  phone?: string
  email?: string
  displayName?: string
}

export interface ContactsPort {
  get(id: string): Promise<Contact>
  getByPhone(tenantId: string, phone: string): Promise<Contact | null>
  getByEmail(tenantId: string, email: string): Promise<Contact | null>
  upsertByExternal(input: UpsertByExternalInput): Promise<Contact>

  // working memory
  readWorkingMemory(id: string): Promise<string>
  upsertWorkingMemorySection(id: string, heading: string, body: string): Promise<void>
  appendWorkingMemory(id: string, line: string): Promise<void>
  removeWorkingMemorySection(id: string, heading: string): Promise<void>

  // segments + opt-out
  setSegments(id: string, segments: string[]): Promise<void>
  setMarketingOptOut(id: string, value: boolean): Promise<void>

  // staff identity
  resolveStaffByExternal(channelInstanceId: string, externalIdentifier: string): Promise<StaffBinding | null>
  bindStaff(userId: string, channelInstanceId: string, externalIdentifier: string): Promise<StaffBinding>

  // deletion (cascades through drive.service.deleteScope)
  delete(id: string): Promise<void>
}
