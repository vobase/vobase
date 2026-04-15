/**
 * Seed: agents module — workspace files (AGENTS.md, SOUL.md) and per-contact
 * agent notes for realistic demo data.
 *
 * Auto-discovered by scripts/db-seed.ts (default export convention).
 */
import type { VobaseDb } from '@vobase/core';

import { seedWorkspaceFiles } from './mastra/workspace/seed-workspace';
import { workspaceFiles } from './schema';

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

// ─── Per-contact agent notes ───────────────────────────────────────
// These are workspace files scoped to agentId + contactId, representing
// observations the agent has accumulated over past conversations.

const AGENT_ID = 'booking';

const CONTACT_NOTES: Array<{
  contactId: string;
  content: string;
}> = [
  {
    contactId: 'c-alice',
    content: `---
segment: loyal-patient
tags: [returning, family-plan, insurance-resolved]
language: en
---

# Notes

- New patient as of 12 days ago; first visit was general consultation with Dr. Tan
- Prefers afternoon slots (booked 2 PM initially)
- Had billing confusion: $120 receipt vs expected $80 — was $80 consultation + $40 blood panel
- Insurance issue with AIA resolved by David (operations) — reference INS-2241
- Blood work results normal per Dr. Lee (haematology specialist visit)
- Husband Edward may also become a patient — link accounts for family pricing
- Interested in Annual Duo Plan ($580 for couples)
- Wants back-to-back checkup slots with husband to minimise trips
- Always validates parking — remind about Block 5 basement, first 2 hours free
- Referral letter from Dr. Tan was in file but she didn't know — proactively check documents next time
`,
  },
  {
    contactId: 'c-bob',
    content: `---
segment: multi-location
tags: [cross-channel, billing-issue, quarterly]
language: en
---

# Notes

- Uses both web chat and email — has assistant Alice CC'd on emails
- Needs appointments at multiple branches (Orchard + Tampines)
- Had duplicate charge issue — refund processed (REF-3301), resolved
- Set up quarterly checkup schedule at Orchard, Tuesday mornings preferred
- Booking references: BK-5102, BK-5103 (original), BK-5104, BK-5105 (rescheduled), BK-5201 (quarterly)
- Account flagged for billing review after duplicate charge incident
- Can be impatient about billing — handle with extra care
`,
  },
  {
    contactId: 'c-charlie',
    content: `---
segment: vip
tags: [vip, monthly-checkup, david-handles]
language: en
---

# Notes

- VIP patient — always handled by David (staff)
- Monthly checkup with Dr. Tan, usually Thursdays
- Prefers private room for consultations
- Often requests extended 90-minute sessions
- On Atorvastatin 20mg for cholesterol — prescription refill as needed
- Prefers delivery for medications when traveling
- Address Mr. Lee formally (not Charlie)
- Cholesterol monitoring ongoing — Dr. Tan reviews numbers each visit
- Has requested home delivery of prescriptions before — pharmacy can courier within 2 business days
`,
  },
  {
    contactId: 'c-diana',
    content: `---
segment: at-risk
tags: [unresponsive, needs-followup]
language: en
---

# Notes

- Tends to go silent mid-conversation — previous inquiry abandoned
- Was asking about weekend appointments (we don't have weekend slots)
- Follow up proactively if no response within 2 hours
- May need a reminder message to re-engage
`,
  },
  {
    contactId: 'c-jenny',
    content: `---
segment: concerned-parent
tags: [urgent, emergency-redirect]
language: en
---

# Notes

- Has a daughter with possible wrist injury — redirected to A&E
- Frustrated with A&E wait times — asked for emergency slot with Dr. Tan
- We don't handle emergency/walk-in injuries — always redirect to A&E
- Currently on hold while checking if any doctor can accommodate
- Handle with empathy — she's stressed about her child
`,
  },
  {
    contactId: 'c-lily',
    content: `---
segment: at-risk
tags: [complaint, escalation, management-pending]
language: en
---

# Notes

- Complained about 45-minute wait past appointment time — second occurrence
- Escalated to management (Eve) but Eve never called back after 2 days
- Threatened to leave a negative review
- Currently following up on the unresolved complaint via WhatsApp
- HIGH PRIORITY — needs immediate resolution from Eve
- Consider offering compensation (free follow-up consultation or discount)
`,
  },
  {
    contactId: 'c-lead-nina',
    content: `---
segment: corporate-prospect
tags: [corporate, wellness, proposal-pending]
language: en
---

# Notes

- Corporate wellness inquiry for ~20 employees
- Wants tailored package: screenings, flu shots, annual checkups with volume discounts
- Colleague Paula CC'd on communications
- Proposal with pricing tiers promised within 24 hours
- Budget-conscious — emphasise group discount (Corporate Wellness Package from $65/employee)
`,
  },
  {
    contactId: 'c-ivan',
    content: `---
segment: corporate-client
tags: [bulk-booking, pending-approval]
language: en
---

# Notes

- Corporate bulk booking for 15 people
- Offered block appointments across 2-3 days with 15% group discount
- HR needs formal quote with pricing tiers
- Draft quote generated but needs manager approval before sending
- Pending pricing verification from operations team
`,
  },
];

// ─── Seed function ──────────────────────────────────────────────────

export default async function seed(ctx: { db: VobaseDb }) {
  const { db } = ctx;

  // Seed global workspace files (AGENTS.md, SOUL.md)
  await seedWorkspaceFiles(db);
  console.log(`${green('✓')} Seeded workspace files (AGENTS.md, SOUL.md)`);

  // Seed per-contact agent notes
  for (const note of CONTACT_NOTES) {
    await db
      .insert(workspaceFiles)
      .values({
        agentId: AGENT_ID,
        contactId: note.contactId,
        path: 'contact/notes.md',
        content: note.content,
        writtenBy: 'system',
      })
      .onConflictDoUpdate({
        target: [
          workspaceFiles.agentId,
          workspaceFiles.contactId,
          workspaceFiles.path,
        ],
        set: { content: note.content, updatedAt: new Date() },
      });
  }
  console.log(
    `${green('✓')} Seeded ${CONTACT_NOTES.length} contact agent notes`,
  );
}
