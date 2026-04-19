/**
 * contacts module seed — inserts:
 *   - 3 auth.user rows (alice, bob, carol) — staff
 *   - 3 inbox.channel_instances rows (customer WA, staff WA, customer Web)
 *   - 3 contacts.staff_channel_bindings (one per staff user)
 *   - 6 contacts.contacts rows (one baseline test customer + five persona customers)
 *
 * Cross-module note: channel_instances (inbox schema) are inserted here because
 * staff_channel_bindings has a FK to inbox.channel_instances and contacts seeds first
 * in dependency order. Both instances are keyed by stable nanoid constants exported below.
 */

// Stable nanoid constants — hardcoded so tests can import them as compile-time constants.
export const MERIDIAN_TENANT_ID = 'mer0tenant'

export const ALICE_USER_ID = 'usr0alice0'
export const BOB_USER_ID = 'usr00bob00'
export const CAROL_USER_ID = 'usrcarol00'

/** Customer-facing WhatsApp channel instance used by the baseline seeded conversation. */
export const CUSTOMER_CHANNEL_INSTANCE_ID = 'chi0cust00'
/** Staff-facing WhatsApp channel instance used for staff bindings. */
export const STAFF_CHANNEL_INSTANCE_ID = 'chi0staff0'
/** Customer-facing web (chat widget) channel instance — used by /test-web dogfood page. */
export const WEB_CHANNEL_INSTANCE_ID = 'chi00web00'
/** Shared dev-mode webhook secret for the web channel (matches CHANNEL_WEB_WEBHOOK_SECRET fallback). */
export const WEB_CHANNEL_WEBHOOK_SECRET = 'dev-secret'

/** The baseline test customer contact — imported by inbox/seed and integration tests. */
export const SEEDED_CONTACT_ID = 'ctt0test00'

/** Persona customers — realistic inbox scenarios in inbox/seed.ts. */
export const PRIYA_CONTACT_ID = 'ctt0priya0'
export const MARCUS_CONTACT_ID = 'ctt0marcus'
export const ELENA_CONTACT_ID = 'ctt0elena0'
export const DEREK_CONTACT_ID = 'ctt0derek0'
export const SOPHIA_CONTACT_ID = 'ctt0sophia'

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
    .values({ id: ALICE_USER_ID, name: 'Alice', email: 'alice@meridian.test', emailVerified: true, role: 'user' })
    .onConflictDoNothing()
  await d
    .insert(authUser)
    .values({ id: BOB_USER_ID, name: 'Bob', email: 'bob@meridian.test', emailVerified: true, role: 'user' })
    .onConflictDoNothing()
  await d
    .insert(authUser)
    .values({ id: CAROL_USER_ID, name: 'Carol', email: 'carol@meridian.test', emailVerified: true, role: 'user' })
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

  await d
    .insert(channelInstances)
    .values({
      id: WEB_CHANNEL_INSTANCE_ID,
      tenantId: MERIDIAN_TENANT_ID,
      type: 'web',
      role: 'customer',
      displayName: 'Meridian Web Chat',
      config: { origin: 'https://meridian.app' },
      webhookSecret: WEB_CHANNEL_WEBHOOK_SECRET,
    })
    .onConflictDoNothing()

  // --- staff channel bindings ---
  await d
    .insert(staffChannelBindings)
    .values({ userId: ALICE_USER_ID, channelInstanceId: STAFF_CHANNEL_INSTANCE_ID, externalIdentifier: '+6591110001' })
    .onConflictDoNothing()
  await d
    .insert(staffChannelBindings)
    .values({ userId: BOB_USER_ID, channelInstanceId: STAFF_CHANNEL_INSTANCE_ID, externalIdentifier: '+6591110002' })
    .onConflictDoNothing()
  await d
    .insert(staffChannelBindings)
    .values({ userId: CAROL_USER_ID, channelInstanceId: STAFF_CHANNEL_INSTANCE_ID, externalIdentifier: '+6591110003' })
    .onConflictDoNothing()

  // --- baseline test customer (kept stable for integration tests) ---
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

  // --- persona customers (drive realistic inbox seed scenarios) ---
  await d
    .insert(contacts)
    .values({
      id: PRIYA_CONTACT_ID,
      tenantId: MERIDIAN_TENANT_ID,
      displayName: 'Priya Raman',
      email: 'priya@acme-labs.io',
      phone: '+6591100201',
      segments: ['pro-plan', 'long-term'],
      workingMemory: [
        '# Priya Raman',
        'Role: Head of Ops @ Acme Labs (Singapore).',
        'Plan: Meridian Pro, 12 seats, annual billing (renewed 2026-02).',
        'Preferences: concise answers, links over prose.',
        '## Open threads',
        '- Asked about Slack integration filtering rules — follow up 2026-04-22.',
      ].join('\n'),
    })
    .onConflictDoNothing()

  await d
    .insert(contacts)
    .values({
      id: MARCUS_CONTACT_ID,
      tenantId: MERIDIAN_TENANT_ID,
      displayName: 'Marcus Chen',
      email: 'marcus.chen@northwind.co',
      phone: '+6591100202',
      segments: ['enterprise-lead'],
      workingMemory: [
        '# Marcus Chen',
        'Role: VP Engineering @ Northwind (400 employees, SG HQ).',
        'Stage: Enterprise eval — asked for SOC 2 + per-user pricing on 2026-04-17.',
        'Next step: alice is drafting a custom quote card; hold on discounts ≥ 20%.',
      ].join('\n'),
    })
    .onConflictDoNothing()

  await d
    .insert(contacts)
    .values({
      id: ELENA_CONTACT_ID,
      tenantId: MERIDIAN_TENANT_ID,
      displayName: 'Elena Rossi',
      email: 'elena@rossi-design.studio',
      phone: '+6591100203',
      segments: ['refund-open'],
      workingMemory: [
        '# Elena Rossi',
        'Plan: Meridian Pro (1 seat) — asked for refund after 12 days of use.',
        'Reason given: product did not solve onboarding flow she needed.',
        'Policy: inside the 14-day window; carol approving full refund.',
      ].join('\n'),
    })
    .onConflictDoNothing()

  await d
    .insert(contacts)
    .values({
      id: DEREK_CONTACT_ID,
      tenantId: MERIDIAN_TENANT_ID,
      displayName: 'Derek Okafor',
      email: 'derek@okafor.dev',
      phone: '+6591100204',
      segments: ['new-signup'],
      workingMemory: '',
    })
    .onConflictDoNothing()

  await d
    .insert(contacts)
    .values({
      id: SOPHIA_CONTACT_ID,
      tenantId: MERIDIAN_TENANT_ID,
      displayName: 'Sophia Nakamura',
      email: 'sophia@nakamura-co.jp',
      phone: '+6591100205',
      segments: ['teams-plan'],
      workingMemory: [
        '# Sophia Nakamura',
        'Plan: Meridian Teams (8 seats). Billing in JPY via Stripe.',
        'Wants: audit log retention bumped to 12 months (Enterprise feature).',
      ].join('\n'),
    })
    .onConflictDoNothing()
}
