/**
 * team module seed — inserts:
 *   - 3 staff_profiles rows (for ALICE/BOB/CAROL — already in auth.user via contacts/seed)
 *   - 3 staff_attribute_definitions (department, seniority, on_call)
 *
 * Runs after contacts/seed.ts (which creates the auth.user rows). The module
 * requires `contacts`, so boot order guarantees auth.user exists when team.seed
 * runs (though seed sequencing is driven separately by scripts/seed.ts — any
 * cross-module seed coupling is encoded via explicit imports of ID constants).
 */

import { ALICE_USER_ID, BOB_USER_ID, CAROL_USER_ID, MERIDIAN_ORG_ID } from '@modules/contacts/seed'

export { ALICE_USER_ID, BOB_USER_ID, CAROL_USER_ID, MERIDIAN_ORG_ID }

export async function seed(db: unknown): Promise<void> {
  const { staffAttributeDefinitions, staffProfiles } = await import('@modules/team/schema')

  const d = db as {
    insert: (t: unknown) => {
      values: (v: unknown) => { onConflictDoNothing: () => Promise<void> }
    }
  }

  // --- staff profiles ------------------------------------------------------
  await d
    .insert(staffProfiles)
    .values({
      userId: ALICE_USER_ID,
      organizationId: MERIDIAN_ORG_ID,
      displayName: 'Alice',
      title: 'Senior Customer Success',
      sectors: ['retail', 'f&b'],
      expertise: ['onboarding', 'sales', 'billing'],
      languages: ['en', 'zh'],
      capacity: 15,
      availability: 'active',
      profile: 'Lead for new SMB onboardings. Fluent Mandarin — route zh-first conversations here.',
      attributes: { department: 'CS', seniority: 'senior', on_call: true },
    })
    .onConflictDoNothing()

  await d
    .insert(staffProfiles)
    .values({
      userId: BOB_USER_ID,
      organizationId: MERIDIAN_ORG_ID,
      displayName: 'Bob',
      title: 'Solutions Engineer',
      sectors: ['fintech', 'saas'],
      expertise: ['integrations', 'tech-support', 'api'],
      languages: ['en'],
      capacity: 20,
      availability: 'active',
      profile: 'Technical escalations. Covers integrations + webhook debugging.',
      attributes: { department: 'Eng', seniority: 'senior', on_call: false },
    })
    .onConflictDoNothing()

  await d
    .insert(staffProfiles)
    .values({
      userId: CAROL_USER_ID,
      organizationId: MERIDIAN_ORG_ID,
      displayName: 'Carol',
      title: 'Billing Lead',
      sectors: ['retail', 'f&b'],
      expertise: ['billing', 'refunds', 'pricing'],
      languages: ['en', 'ms'],
      capacity: 10,
      availability: 'busy',
      profile: 'Approval authority on refunds up to SGD 500. OOO Fridays.',
      attributes: { department: 'Ops', seniority: 'lead', on_call: true },
    })
    .onConflictDoNothing()

  // --- attribute definitions ----------------------------------------------
  const defs: {
    id: string
    key: string
    label: string
    type: 'text' | 'number' | 'boolean' | 'date' | 'enum'
    options: string[]
    showInTable: boolean
    sortOrder: number
  }[] = [
    {
      id: 'sad0dept000',
      key: 'department',
      label: 'Department',
      type: 'enum',
      options: ['CS', 'Eng', 'Ops', 'Sales'],
      showInTable: true,
      sortOrder: 10,
    },
    {
      id: 'sad0senior0',
      key: 'seniority',
      label: 'Seniority',
      type: 'enum',
      options: ['junior', 'mid', 'senior', 'lead'],
      showInTable: true,
      sortOrder: 20,
    },
    {
      id: 'sad0oncall0',
      key: 'on_call',
      label: 'On-call',
      type: 'boolean',
      options: [],
      showInTable: true,
      sortOrder: 30,
    },
    {
      id: 'sad0timezo0',
      key: 'timezone',
      label: 'Timezone',
      type: 'text',
      options: [],
      showInTable: false,
      sortOrder: 40,
    },
  ]
  for (const def of defs) {
    await d
      .insert(staffAttributeDefinitions)
      .values({ organizationId: MERIDIAN_ORG_ID, ...def })
      .onConflictDoNothing()
  }
}
