/**
 * contacts module seed — inserts:
 *   - 3 auth.user rows (alice, bob, carol)
 *   - 2 inbox.channel_instances rows (customer-facing + staff-facing)
 *   - 3 contacts.staff_channel_bindings (one per staff user)
 *   - 1 contacts.contacts row for the test customer
 *
 * Cross-module note: channel_instances (inbox schema) are inserted here because
 * staff_channel_bindings has a FK to inbox.channel_instances and contacts seeds first
 * per spec §4.3. Both instances are keyed by stable nanoid constants exported below.
 */

// Stable nanoid constants — hardcoded so tests can import them as compile-time constants.
export const MERIDIAN_TENANT_ID = 'mer0tenant'

export const ALICE_USER_ID = 'usr0alice0'
export const BOB_USER_ID = 'usr00bob00'
export const CAROL_USER_ID = 'usrcarol00'

/** Customer-facing WhatsApp channel instance used for the seeded conversation. */
export const CUSTOMER_CHANNEL_INSTANCE_ID = 'chi0cust00'
/** Staff-facing WhatsApp channel instance used for staff bindings. */
export const STAFF_CHANNEL_INSTANCE_ID = 'chi0staff0'

/** The test customer contact — imported by inbox/seed and integration tests. */
export const SEEDED_CONTACT_ID = 'ctt0test00'

export async function seed(db: unknown): Promise<void> {
  const { channelInstances } = await import('@modules/inbox/schema')
  const { contacts, staffChannelBindings } = await import('@modules/contacts/schema')
  const { authUser } = await import('@vobase/core')

  const d = db as {
    insert: (t: unknown) => {
      values: (v: unknown) => { onConflictDoNothing: () => Promise<void> }
    }
  }

  // --- auth users (alice, bob, carol) ---
  await d
    .insert(authUser)
    .values({
      id: ALICE_USER_ID,
      name: 'Alice',
      email: 'alice@meridian.test',
      emailVerified: true,
      role: 'user',
    })
    .onConflictDoNothing()

  await d
    .insert(authUser)
    .values({
      id: BOB_USER_ID,
      name: 'Bob',
      email: 'bob@meridian.test',
      emailVerified: true,
      role: 'user',
    })
    .onConflictDoNothing()

  await d
    .insert(authUser)
    .values({
      id: CAROL_USER_ID,
      name: 'Carol',
      email: 'carol@meridian.test',
      emailVerified: true,
      role: 'user',
    })
    .onConflictDoNothing()

  // --- channel instances (inbox schema — inserted early for FK correctness) ---
  await d
    .insert(channelInstances)
    .values({
      id: CUSTOMER_CHANNEL_INSTANCE_ID,
      tenantId: MERIDIAN_TENANT_ID,
      type: 'whatsapp',
      role: 'customer',
      displayName: 'Meridian Customer WA',
      config: { phoneNumberId: '111000111' },
    })
    .onConflictDoNothing()

  await d
    .insert(channelInstances)
    .values({
      id: STAFF_CHANNEL_INSTANCE_ID,
      tenantId: MERIDIAN_TENANT_ID,
      type: 'whatsapp',
      role: 'staff',
      displayName: 'Meridian Staff WA',
      config: { phoneNumberId: '222000222' },
    })
    .onConflictDoNothing()

  // --- staff channel bindings ---
  await d
    .insert(staffChannelBindings)
    .values({
      userId: ALICE_USER_ID,
      channelInstanceId: STAFF_CHANNEL_INSTANCE_ID,
      externalIdentifier: '+6591110001',
    })
    .onConflictDoNothing()

  await d
    .insert(staffChannelBindings)
    .values({
      userId: BOB_USER_ID,
      channelInstanceId: STAFF_CHANNEL_INSTANCE_ID,
      externalIdentifier: '+6591110002',
    })
    .onConflictDoNothing()

  await d
    .insert(staffChannelBindings)
    .values({
      userId: CAROL_USER_ID,
      channelInstanceId: STAFF_CHANNEL_INSTANCE_ID,
      externalIdentifier: '+6591110003',
    })
    .onConflictDoNothing()

  // --- test customer contact ---
  await d
    .insert(contacts)
    .values({
      id: SEEDED_CONTACT_ID,
      tenantId: MERIDIAN_TENANT_ID,
      displayName: 'Test Customer',
      phone: '+6500000000',
      workingMemory: '',
    })
    .onConflictDoNothing()
}
