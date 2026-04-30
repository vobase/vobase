/**
 * contacts module seed — inserts:
 *   - 3 auth.user rows (alice, bob, carol) — staff
 *   - 3 auth.account rows (dev provider) so the dev-login flow lands cleanly
 *   - 3 channels.channel_instances rows (customer WA, staff WA, customer Web)
 *   - 3 contacts.staff_channel_bindings (one per staff user)
 *   - 6 contacts.contacts rows (one baseline test customer + five persona customers)
 *
 * Dev login: `src/shell/auth/login.tsx` posts `alice@meridian.test` to
 * `/api/auth/dev-login`; `internalAdapter.findUserByEmail` resolves Alice to
 * `ALICE_USER_ID`, which is also the `staff_profiles.user_id` — so
 * `useCurrentUserId()` returns a real staff id in-browser.
 *
 * Cross-module note: channel_instances (channels schema) are inserted here because
 * staff_channel_bindings has a FK to channels.channel_instances and contacts seeds first
 * in dependency order. Both instances are keyed by stable nanoid constants exported below.
 */

// Stable nanoid constants — hardcoded so tests can import them as compile-time constants.
export const MERIDIAN_ORG_ID = 'mer0tenant'

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

/** The baseline test customer contact — imported by messaging/seed and integration tests. */
export const SEEDED_CONTACT_ID = 'ctt0test00'

/** Persona customers — realistic messaging scenarios in messaging/seed.ts. */
export const PRIYA_CONTACT_ID = 'ctt0priya0'
export const MARCUS_CONTACT_ID = 'ctt0marcus'
export const ELENA_CONTACT_ID = 'ctt0elena0'
export const DEREK_CONTACT_ID = 'ctt0derek0'
export const SOPHIA_CONTACT_ID = 'ctt0sophia'
export const LIAM_CONTACT_ID = 'ctt00liam0'

export async function seed(db: unknown): Promise<void> {
  // biome-ignore lint/plugin/no-dynamic-import: seeds load schema lazily to avoid module-init-order issues (convention across modules/*/seed.ts)
  const { channelInstances } = await import('@modules/channels/schema')
  // biome-ignore lint/plugin/no-dynamic-import: seeds load schema lazily to avoid module-init-order issues (convention across modules/*/seed.ts)
  const { contactAttributeDefinitions, contacts, staffChannelBindings } = await import('@modules/contacts/schema')
  // biome-ignore lint/plugin/no-dynamic-import: seeds load schema lazily to avoid module-init-order issues (convention across modules/*/seed.ts)
  const { authAccount, authMember, authOrganization, authUser } = await import('@vobase/core')

  const d = db as {
    insert: (t: unknown) => {
      values: (v: unknown) => { onConflictDoNothing: () => Promise<void> }
    }
  }

  // --- auth organization (Meridian) + memberships ---
  // Seeded so requireOrganization's fallback lookup can resolve a membership
  // for every staff user, and `auth.api.setActiveOrganization` succeeds on
  // first request after sign-in.
  await d
    .insert(authOrganization)
    .values({ id: MERIDIAN_ORG_ID, name: 'Meridian', slug: 'meridian' })
    .onConflictDoNothing()

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

  // --- auth accounts (dev provider) — lets /auth/dev-login resolve cleanly ---
  for (const [accountId, userId] of [
    ['acc0alice0', ALICE_USER_ID],
    ['acc000bob0', BOB_USER_ID],
    ['acc0carol0', CAROL_USER_ID],
  ] as const) {
    await d
      .insert(authAccount)
      .values({ id: accountId, accountId: userId, providerId: 'dev', userId })
      .onConflictDoNothing()
  }

  // --- auth memberships — Alice owner, Bob/Carol members ---
  await d
    .insert(authMember)
    .values({ id: 'mbr0alice0', userId: ALICE_USER_ID, organizationId: MERIDIAN_ORG_ID, role: 'owner' })
    .onConflictDoNothing()
  await d
    .insert(authMember)
    .values({ id: 'mbr00bob00', userId: BOB_USER_ID, organizationId: MERIDIAN_ORG_ID, role: 'member' })
    .onConflictDoNothing()
  await d
    .insert(authMember)
    .values({ id: 'mbr0carol0', userId: CAROL_USER_ID, organizationId: MERIDIAN_ORG_ID, role: 'member' })
    .onConflictDoNothing()

  // --- channel instances (channels schema — inserted early for FK correctness) ---
  await d
    .insert(channelInstances)
    .values({
      id: CUSTOMER_CHANNEL_INSTANCE_ID,
      organizationId: MERIDIAN_ORG_ID,
      channel: 'whatsapp',
      role: 'customer',
      displayName: 'Meridian Customer WA',
      config: { phoneNumberId: '111000111', defaultAssignee: 'agent:agt0meri0v1' },
    })
    .onConflictDoNothing()

  await d
    .insert(channelInstances)
    .values({
      id: STAFF_CHANNEL_INSTANCE_ID,
      organizationId: MERIDIAN_ORG_ID,
      channel: 'whatsapp',
      role: 'staff',
      displayName: 'Meridian Staff WA',
      config: { phoneNumberId: '222000222' },
    })
    .onConflictDoNothing()

  await d
    .insert(channelInstances)
    .values({
      id: WEB_CHANNEL_INSTANCE_ID,
      organizationId: MERIDIAN_ORG_ID,
      channel: 'web',
      role: 'customer',
      displayName: 'Meridian Web Chat',
      config: { origin: 'https://meridian.app', defaultAssignee: 'agent:agt0meri0v1' },
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

  // --- custom attribute definitions ---
  const attrDefs: {
    id: string
    key: string
    label: string
    type: 'text' | 'number' | 'boolean' | 'date' | 'enum'
    options: string[]
    showInTable: boolean
    sortOrder: number
  }[] = [
    {
      id: 'cad0company',
      key: 'company',
      label: 'Company',
      type: 'text',
      options: [],
      showInTable: true,
      sortOrder: 10,
    },
    {
      id: 'cad0plan000',
      key: 'plan_tier',
      label: 'Plan',
      type: 'enum',
      options: ['free', 'pro', 'teams', 'enterprise'],
      showInTable: true,
      sortOrder: 20,
    },
    {
      id: 'cad0ltv0000',
      key: 'lifetime_value',
      label: 'Lifetime value (USD)',
      type: 'number',
      options: [],
      showInTable: false,
      sortOrder: 30,
    },
    {
      id: 'cad0renew00',
      key: 'renewal_date',
      label: 'Renewal date',
      type: 'date',
      options: [],
      showInTable: false,
      sortOrder: 40,
    },
    { id: 'cad0vip0000', key: 'vip', label: 'VIP', type: 'boolean', options: [], showInTable: true, sortOrder: 50 },
  ]
  for (const def of attrDefs) {
    await d
      .insert(contactAttributeDefinitions)
      .values({ organizationId: MERIDIAN_ORG_ID, ...def })
      .onConflictDoNothing()
  }

  // --- baseline test customer (kept stable for integration tests) ---
  await d
    .insert(contacts)
    .values({
      id: SEEDED_CONTACT_ID,
      organizationId: MERIDIAN_ORG_ID,
      displayName: 'Test Customer',
      phone: '+6500000000',
      memory: '',
    })
    .onConflictDoNothing()

  // --- persona customers (drive realistic messaging seed scenarios) ---
  await d
    .insert(contacts)
    .values({
      id: PRIYA_CONTACT_ID,
      organizationId: MERIDIAN_ORG_ID,
      displayName: 'Priya Raman',
      email: 'priya@acme-labs.io',
      phone: '+6591100201',
      segments: ['pro-plan', 'long-term'],
      attributes: {
        company: 'Acme Labs',
        plan_tier: 'pro',
        lifetime_value: 14400,
        renewal_date: '2027-02-01',
        vip: true,
      },
      memory: [
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
      organizationId: MERIDIAN_ORG_ID,
      displayName: 'Marcus Chen',
      email: 'marcus.chen@northwind.co',
      phone: '+6591100202',
      segments: ['enterprise-lead'],
      attributes: {
        company: 'Northwind',
        plan_tier: 'enterprise',
        lifetime_value: 0,
        vip: false,
      },
      memory: [
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
      organizationId: MERIDIAN_ORG_ID,
      displayName: 'Elena Rossi',
      email: 'elena@rossi-design.studio',
      phone: '+6591100203',
      segments: ['refund-open'],
      attributes: {
        company: 'Rossi Design',
        plan_tier: 'pro',
        lifetime_value: 49,
      },
      memory: [
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
      organizationId: MERIDIAN_ORG_ID,
      displayName: 'Derek Okafor',
      email: 'derek@okafor.dev',
      phone: '+6591100204',
      segments: ['new-signup'],
      memory: '',
    })
    .onConflictDoNothing()

  await d
    .insert(contacts)
    .values({
      id: LIAM_CONTACT_ID,
      organizationId: MERIDIAN_ORG_ID,
      displayName: 'Liam Reyes',
      email: 'liam@finsight.io',
      phone: '+6591100206',
      segments: ['pro-plan', 'integrator'],
      attributes: {
        company: 'FinSight',
        plan_tier: 'pro',
        lifetime_value: 7200,
        renewal_date: '2026-09-30',
        vip: false,
      },
      memory: [
        '# Liam Reyes',
        'Role: Solutions architect @ FinSight (PayTech, Pro plan).',
        'Stack: webhook-driven integration with their core ledger; sensitive to retry semantics.',
        'Comms: technical, prefers terse answers + code refs over prose.',
      ].join('\n'),
    })
    .onConflictDoNothing()

  await d
    .insert(contacts)
    .values({
      id: SOPHIA_CONTACT_ID,
      organizationId: MERIDIAN_ORG_ID,
      displayName: 'Sophia Nakamura',
      email: 'sophia@nakamura-co.jp',
      phone: '+6591100205',
      segments: ['teams-plan'],
      attributes: {
        company: 'Nakamura & Co',
        plan_tier: 'teams',
        lifetime_value: 9800,
        renewal_date: '2026-11-15',
        vip: true,
      },
      memory: [
        '# Sophia Nakamura',
        'Plan: Meridian Teams (8 seats). Billing in JPY via Stripe.',
        'Wants: audit log retention bumped to 12 months (Enterprise feature).',
      ].join('\n'),
    })
    .onConflictDoNothing()
}
