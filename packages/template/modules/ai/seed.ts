/**
 * Seed: interactions module — realistic demo data for a booking service.
 *
 * Covers every lifecycle state and new model feature:
 * - ~20 named contacts (customers, leads, staff) with intentional relationships
 * - 3 channel instances (WhatsApp, Web, Email) + 3 routings
 * - ~90 interactions across all statuses, modes, outcomes, and autonomy levels
 * - Multi-interaction contacts for timeline testing
 * - Reopened interactions (reopenCount > 0)
 * - Topic change pending interactions
 * - Interaction participants (multi-participant / CC / BCC)
 * - Channel instance → team mappings
 * - ~3 messages per interaction
 * - ~12 consultations across all states
 * - ~6 eval runs, 3 custom scorers
 * - Labels, reactions, feedback, channel sessions, activity events
 */

import { faker } from '@faker-js/faker';
import type { VobaseDb } from '@vobase/core';
import { eq } from 'drizzle-orm';

import {
  aiEvalRuns,
  aiScorers,
  channelInstances,
  channelInstanceTeams,
  channelRoutings,
  channelSessions,
  consultations,
  contactLabels,
  contacts,
  interactionLabels,
  interactionParticipants,
  interactions,
  labels,
  messageFeedback,
  messages,
  reactions,
} from './schema';

// Deterministic seed so `bun run db:seed` always produces the same data
faker.seed(42);

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

function hoursAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 60 * 1000);
}

function pick<T>(arr: T[]): T {
  return arr[faker.number.int({ min: 0, max: arr.length - 1 })];
}

// ─── Scripted narratives for handcrafted contacts ───────────────────
// Each key is an interaction ID. Turns are [customer, agent] pairs that
// read as a continuous story when viewing the contact's timeline.

const SCRIPTED: Record<string, Array<[string, string]>> = {
  // ── Alice: 10 WhatsApp interactions over 12 days ───────────────────
  // Continuous journey: new patient → booking → post-visit → billing issue → referral → loyalty
  'int-alice-wa-01': [
    [
      'Hi, I would like to book an appointment please.',
      'Hi Alice! I am your booking assistant. How can I help you today?',
    ],
    [
      'Do you have anything on Wednesday afternoon?',
      'Yes! I have 2:00 PM and 3:30 PM available this Wednesday. Which works better?',
    ],
    [
      '2 PM please.',
      'Done! Your appointment is confirmed for Wednesday at 2:00 PM. Reference: BK-4821. See you then!',
    ],
  ],
  'int-alice-wa-02': [
    [
      'Hi, quick question before my appointment tomorrow — do I need to fast?',
      'Hi Alice! For a general consultation, no fasting is required. Just bring your ID and any current medications list.',
    ],
    [
      'Great, and where exactly is the clinic? I have not been before.',
      'We are at Block 5, #03-12, Orchard Medical Centre. Basement parking available — first 2 hours free. See you tomorrow at 2 PM!',
    ],
  ],
  'int-alice-wa-03': [
    [
      'Hi, just had my appointment. Dr. Tan was great. Quick question though.',
      'Glad to hear it went well, Alice! What is your question?',
    ],
    [
      'The receipt shows $120 but I thought consultations were $80?',
      'Good catch — the $120 includes the blood panel Dr. Tan ordered. I can break it down: $80 consultation + $40 lab work. Does that look right?',
    ],
    [
      'Ah ok. Actually, can I ask about my insurance coverage? That is a different topic.',
      'Sure! Since this is a billing/insurance question, let me close out the visit follow-up and start fresh on the insurance topic.',
    ],
  ],
  'int-alice-wa-04': [
    [
      'So my AIA plan should cover the lab work but the portal shows an outstanding balance.',
      'I see — insurance billing is outside what I can resolve directly. Let me connect you with our operations team.',
    ],
    [
      'Ok, please get back to me soon. I do not want this to go to collections.',
      'Understood — I am flagging this as urgent. David from operations will check your AIA coverage and sort out the balance today.',
    ],
    [
      'Thanks, I will wait for David.',
      'David has been notified and will reach out within the hour. Your reference for this issue is INS-2241.',
    ],
  ],
  'int-alice-wa-05': [
    [
      'Hey, David sorted out the insurance. All good now. I need to reschedule my follow-up.',
      'Great news about the insurance! Let me check follow-up availability. When were you thinking?',
    ],
    [
      'Sometime next week? Morning if possible.',
      'I have Tuesday 9:30 AM and Thursday 10:00 AM. Either work?',
    ],
    [
      'Actually wait — can I reopen this? I just realized I also need to bring my lab results.',
      'Of course! I have noted that. Bring your lab results printout to the follow-up. Shall I book Tuesday 9:30 AM?',
    ],
    [
      'Yes, Tuesday works.',
      'Booked! Tuesday 9:30 AM, follow-up consultation. Bring your lab results. Reference: BK-4856.',
    ],
  ],
  'int-alice-wa-06': [
    [
      'Quick question — is there parking validation for the Tuesday visit too?',
      'Yes, Alice! Same as before — basement parking at Block 5, first 2 hours free. Just validate at reception.',
    ],
    ['Perfect, thanks!', 'You are welcome! See you Tuesday.'],
  ],
  'int-alice-wa-07': [
    [
      'Dr. Tan mentioned I should see a specialist for the blood work results. Can you help arrange?',
      'Of course, Alice. Dr. Tan can refer you to our haematology specialist, Dr. Lee. Let me check her availability.',
    ],
    [
      'Is she good? I am a bit nervous about specialist visits.',
      'Dr. Lee is excellent — she has been with us for 8 years and is very patient. I am connecting David to help coordinate since specialist bookings need manual confirmation.',
    ],
    [
      'Ok, whatever is fastest. I have been worrying about these results.',
      'Completely understand. David is arranging a priority slot for you. He will confirm the date and time shortly.',
    ],
  ],
  'int-alice-wa-08': [
    [
      'David confirmed Thursday 10:30 AM with Dr. Lee. Just want to double-check that is right.',
      'Confirmed! Thursday 10:30 AM with Dr. Lee (haematology). Bring your ID, lab results, and referral letter from Dr. Tan.',
    ],
    [
      'What referral letter? I did not get one.',
      'Dr. Tan would have issued it after your last visit. Let me check — yes, it is in your file. I will ask reception to have a printed copy ready when you arrive.',
    ],
    [
      'Oh great, thanks for catching that.',
      'No problem! Everything is set for Thursday. Good luck with the appointment!',
    ],
  ],
  'int-alice-wa-09': [
    [
      'Specialist visit went well! Dr. Lee said everything looks normal. Huge relief.',
      'That is wonderful news, Alice! So glad to hear it.',
    ],
    [
      'Thanks for all the help over the past couple weeks. Actually — do you offer family health plans? My husband might need a checkup too.',
      'We do! Since this is a new topic, let me wrap up the specialist follow-up and start a fresh inquiry about family plans.',
    ],
  ],
  'int-alice-wa-10': [
    [
      'So about that family plan — what packages do you have?',
      'Welcome back, Alice! We offer several family wellness packages. For couples, the most popular is the Annual Duo Plan: 2 full checkups + 2 follow-ups for $580 (normally $720).',
    ],
    [
      'That sounds good. My husband Edward might also want to sign up separately though. Can he message you directly?',
      'Absolutely! He can reach us on this same WhatsApp number. I will make a note to link your accounts for family pricing.',
    ],
    [
      'Great. One more thing — can we book the checkups back-to-back so we only make one trip?',
      'Smart idea! Let me check for side-by-side morning slots. I will get back to you with options shortly.',
    ],
  ],

  // ── Bob: 8 cross-channel interactions (Web + Email) ────────────────
  'int-bob-web-01': [
    [
      'I need to book consultations at two locations — Orchard and Tampines. Back-to-back if possible.',
      'Hi Bob! Multi-branch bookings need manual coordination. Let me check both locations for you.',
    ],
    [
      'The sooner the better. Ideally next week.',
      'I have flagged this for our scheduling team. David will coordinate the dual booking and reach out shortly.',
    ],
  ],
  'int-bob-email-01': [
    [
      'Hi, this is Bob Wong. Following up on my multi-branch booking from web chat. Cc-ing my assistant Alice.',
      'Hi Bob! Your bookings are confirmed: Orchard Monday 10 AM, Tampines Monday 2 PM. References: BK-5102 and BK-5103.',
    ],
    [
      'Can you send details to this thread so my assistant has them?',
      'Done! Full confirmation sent. Both appointments locked in.',
    ],
  ],
  'int-bob-web-02': [
    [
      'My Monday schedule changed. Can we move Orchard to Tuesday?',
      'Hi Bob! Checking Tuesday... 10:00 AM is available at Orchard. Tampines stays Monday 2 PM. Update both?',
    ],
    [
      'Yes please. Sorry for the changes.',
      'No problem! Updated: Orchard → Tuesday 10 AM (BK-5104), Tampines → Monday 2 PM (BK-5105).',
    ],
  ],
  'int-bob-web-03': [
    [
      'I got charged twice for the Orchard appointment. Can you check?',
      'Oh no — let me look into that right away, Bob. I can see two charges on your account.',
    ],
    [
      'This is frustrating. I want a refund for the duplicate.',
      'Completely understandable. I am escalating this to our billing team for an immediate refund. They will process it within 24-48 hours.',
    ],
    [
      'Make sure it actually happens this time.',
      'I have flagged it as urgent. You will receive an email confirmation once the refund is processed.',
    ],
  ],
  'int-bob-email-02': [
    [
      'Subject: Refund Confirmation\n\nDid the duplicate charge refund go through? I do not see it yet.',
      'Hi Bob! I checked — the refund was processed yesterday and should appear in your account within 1-2 business days. Reference: REF-3301.',
    ],
    [
      'Ok, I will check tomorrow. Thanks.',
      'You are welcome! Let us know if it does not show up by Friday.',
    ],
  ],
  'int-bob-web-04': [
    [
      'What should I bring to the Tampines appointment?',
      'Hi Bob! For Tampines, bring your ID and the referral note from your Orchard visit (if applicable). Also bring your medication list.',
    ],
    ['Got it, thanks.', 'You are all set! See you Monday at 2 PM at Tampines.'],
  ],
  'int-bob-web-05': [
    [
      'Both appointments done. Orchard was great, Tampines was a bit rushed.',
      'Thanks for the feedback, Bob! I will pass the Tampines note to our quality team. Anything else you need?',
    ],
    [
      'Actually yes — I want to book the next quarterly checkup. Different topic though.',
      'Got it! Let me close out the feedback and start fresh on the quarterly booking.',
    ],
  ],
  'int-bob-web-06': [
    [
      'So for the quarterly checkup — can I do Orchard only this time?',
      'Sure, Bob! Orchard has good availability. Same time preference — Tuesday mornings?',
    ],
    [
      'Yes, and can you set it up as a recurring quarterly booking?',
      'I can book the next one now and set a reminder for the following quarter. Tuesday 10 AM, 3 months from now?',
    ],
    [
      'Perfect. And this time no duplicate charges please!',
      'Ha! Noted. Your quarterly booking is confirmed: BK-5201. I have also flagged your account for billing review. No more duplicates!',
    ],
  ],

  // ── Charlie: VIP, 6 interactions ───────────────────────────────────
  'int-charlie-wa-01': [
    [
      'This is Charlie Lee. Monthly checkup please.',
      "Good morning, Mr. Lee! Checking Dr. Tan's availability for your monthly slot.",
    ],
    [
      'Thursday as usual. Private room.',
      'Thursday 2 PM, private room confirmed. David will handle your booking personally as always.',
    ],
  ],
  'int-charlie-wa-02': [
    [
      'David, can we change Thursday to 3 PM? My meeting ran over.',
      'Hi Mr. Lee! David has shifted your appointment to 3 PM. Same private room.',
    ],
    [
      'Good. Also, I need the extended 90-minute session this time.',
      'Noted — 90-minute session with Dr. Tan at 3 PM. Updated.',
    ],
  ],
  'int-charlie-wa-03': [
    [
      'Checkup went well. Dr. Tan wants to discuss the cholesterol numbers. When can I call in?',
      'Glad to hear it went well! For the results discussion, Dr. Tan has a call slot at 11 AM tomorrow. Shall I book that?',
    ],
    [
      'Yes. Actually, better have David arrange it. I need my full records pulled.',
      'Understood. David will pull your records and set up the call with Dr. Tan for 11 AM tomorrow.',
    ],
  ],
  'int-charlie-wa-04': [
    [
      'I need a refill on my cholesterol medication. Same prescription as last time.',
      'Hi Mr. Lee! I can see your last prescription — Atorvastatin 20mg. I will have the pharmacy prepare it for pickup.',
    ],
    [
      'Actually, can it be delivered? I am traveling this week.',
      'Checking delivery options... yes, we can courier it to your registered address. It will arrive within 2 business days.',
    ],
    [
      'Wait — I reopened this because I also need the blood pressure meds refilled. Same order.',
      'Added! Both prescriptions will be in the delivery: Atorvastatin 20mg + Amlodipine 5mg. Delivery confirmed.',
    ],
  ],
  'int-charlie-wa-05': [
    [
      'Need to see Dr. Tan again. 90-minute session, private room. Next Thursday.',
      'Hi Mr. Lee! Next Thursday is available. David will confirm the 90-minute private room session.',
    ],
    [
      'Tell David to also book the lab for a full panel before the appointment.',
      'Noted — full blood panel + 90-minute consultation. David is arranging both.',
    ],
  ],
  'int-charlie-wa-06': [
    [
      'Test results in yet? I am getting anxious about the cholesterol recheck.',
      'Hi Mr. Lee, let me check with the lab... the results are in and have been sent to Dr. Tan for review.',
    ],
    [
      'Can David call me to discuss before the Thursday appointment?',
      'David is reviewing now and will call you within the hour.',
    ],
  ],

  // ── Diana: abandoned ───────────────────────────────────────────────
  'int-diana-wa-1': [
    [
      'Hi, do you offer weekend appointments?',
      'Hi Diana! Yes, we have Saturday 9 AM to 5 PM. Would you like to book?',
    ],
    [
      'What is available this Saturday?',
      'This Saturday: 9:00 AM, 11:30 AM, and 2:00 PM. Which works?',
    ],
    [
      'Let me check and get back to you.',
      'Sure, take your time! Just message when you are ready.',
    ],
  ],

  // ── Edward: resolving ──────────────────────────────────────────────
  'int-edward-web-1': [
    [
      'I want to book a general checkup for next week.',
      'Hi Edward! Morning or afternoon?',
    ],
    [
      'Morning please, before 11.',
      'Monday 9:00 AM or Thursday 10:30 AM. Preference?',
    ],
    [
      'Thursday 10:30.',
      'Confirmed! Thursday 10:30 AM. Reference: BK-5201. Anything else?',
    ],
    ['No, that is all. Thanks!', 'See you Thursday, Edward!'],
  ],

  // ── Fiona: failed ──────────────────────────────────────────────────
  'int-fiona-web-1': [
    [
      'I need to book three appointments for my family — myself, husband, and daughter (8 years old).',
      'Hi Fiona! Three general checkups. Let me check family block availability...',
    ],
  ],

  // ── George: topic change pending ───────────────────────────────────
  'int-george-wa-1': [
    [
      'Hey, confirming my Friday 3:30 PM is still on.',
      'Hi George! Yes, confirmed. Reference: BK-4990.',
    ],
    [
      'Great. Do you also do physiotherapy? Different question.',
      'We do! Let me close the appointment confirmation and start a new inquiry for physio.',
    ],
    [
      'Sure, go ahead.',
      'Friday appointment is set. Next message will start a fresh physiotherapy conversation!',
    ],
  ],

  // ── Hannah: human mode ─────────────────────────────────────────────
  'int-hannah-web-1': [
    [
      'I want a refund for my no-show. I called 20 minutes ahead — I was stuck in traffic.',
      'I understand, Hannah. Since you called ahead, let me check if we can make an exception to the no-show policy.',
    ],
    [
      'I should not have to pay full price when I gave notice.',
      'You are right that calling ahead makes a difference. Refund exceptions need manager approval — transferring you to a staff member.',
    ],
    [
      'How long will this take? I have been going back and forth for days.',
      'David is looking at your case now and will respond here shortly. Apologies for the delay.',
    ],
  ],

  // ── Ivan: supervised ───────────────────────────────────────────────
  'int-ivan-web-1': [
    [
      'We have 15 employees who need annual checkups. Bulk booking possible?',
      'Hi Ivan! Yes, for 15 people we can arrange block appointments across 2-3 days with a 15% group discount.',
    ],
    [
      'HR needs a formal quote with pricing tiers.',
      'Drafting a quote now — a team member will verify pricing before I send it to you.',
    ],
  ],

  // ── Jenny: held ────────────────────────────────────────────────────
  'int-jenny-wa-1': [
    [
      'URGENT — my daughter fell and may have broken her wrist. Can we come in now?',
      'I am sorry to hear that, Jenny! For injuries, please go to the nearest A&E. We handle scheduled appointments only.',
    ],
    [
      'The A&E wait is 3 hours. Can Dr. Tan see her as emergency?',
      'Dr. Tan is fully booked, but I am checking if any doctor can fit an emergency slot. Please hang tight.',
    ],
  ],

  // ── Kenny: email ───────────────────────────────────────────────────
  'int-kenny-email-1': [
    [
      'Subject: Appointment Confirmation\n\nPlease confirm my appointment details. Name: Kenny Ng.',
      'Hi Kenny! Confirmed: Thursday 2 PM, General Consultation with Dr. Tan. Reference: BK-5300.',
    ],
    [
      'Is parking available?',
      'Yes! Basement parking at Block 5 — first 2 hours free. Validate at reception.',
    ],
  ],

  // ── Lily: escalation story ─────────────────────────────────────────
  'int-lily-web-1': [
    [
      'I have been waiting 45 minutes past my appointment time.',
      'I sincerely apologize, Lily. Let me check on the delay.',
    ],
    [
      'This is the second time. Last month was the same.',
      'Repeated delays are unacceptable. Escalating to management. Eve will follow up.',
    ],
    [
      'I want compensation or I am leaving a review.',
      'Completely understandable. Eve will contact you within the hour.',
    ],
  ],
  'int-lily-wa-1': [
    [
      'Eve was supposed to call back about my complaint. It has been 2 days.',
      'I am sorry about the delay. Escalating again with higher priority.',
    ],
    [
      'I am not interested in more escalation. I want an answer.',
      'You are right. Getting Eve on this chat directly to resolve this now.',
    ],
  ],

  // ── Leads ──────────────────────────────────────────────────────────
  'int-lead-mark-1': [
    [
      'Saw your Google ad for new patient specials. What is the deal?',
      'Hi Mark! New patients get 20% off their first consultation.',
    ],
    [
      'What services does it cover?',
      'General consultations, health screenings, and dental. Specialist referrals at standard pricing.',
    ],
    ['Let me think about it.', 'No rush! The offer is valid for 30 days.'],
  ],
  'int-lead-nina-1': [
    [
      'Looking into corporate wellness for about 20 employees.',
      'Hello Nina! We offer tailored packages — screenings, flu shots, and annual checkups with volume discounts.',
    ],
    [
      'Can you send a proposal? Cc my colleague Paula.',
      'Absolutely! Proposal with pricing tiers coming within 24 hours.',
    ],
  ],
  'int-lead-oscar-1': [
    [
      'Saw the Instagram promo. Still running?',
      'Hi Oscar! Yes — 15% off any booking this month.',
    ],
    ['Maybe later.', 'No problem! Promo runs until end of month.'],
  ],
};

// Generic dialogue turns used only for bulk (random) interactions
const GENERIC_TURNS: Array<[string, string]> = [
  [
    'Hi, I would like to book an appointment please.',
    'Hi! I am your booking assistant. How can I help you today?',
  ],
  [
    'Do you have any slots available this week?',
    'Let me check availability for you. We have openings on Monday, Wednesday, and Friday.',
  ],
  [
    'What times do you have on Wednesday?',
    'Wednesday slots: 10:00 AM, 11:30 AM, 2:00 PM, 3:30 PM. Which works best?',
  ],
  [
    'Afternoon would be better for me.',
    'We have 2:00 PM and 3:30 PM on Wednesday, and 1:00 PM on Thursday. Any preference?',
  ],
  [
    'Let me go with Wednesday at 2 PM.',
    'Confirmed! Reference: BK-4821. See you Wednesday at 2:00 PM.',
  ],
  [
    'I need to reschedule my appointment.',
    'Let me pull up your booking. When would you like to reschedule to?',
  ],
  [
    'Can I move it to Friday instead?',
    'Friday works. I have 10:00 AM and 2:30 PM available. Which do you prefer?',
  ],
  ['Thanks, that is all I need.', 'You are welcome! Have a great day.'],
  [
    'Do I need to bring anything?',
    'Please bring a valid ID and any relevant medical records.',
  ],
  [
    'How long will the appointment take?',
    'A general consultation typically takes 30-45 minutes.',
  ],
  [
    'What is your cancellation policy?',
    'You can cancel or reschedule up to 24 hours before at no charge.',
  ],
  [
    'Do you have anything earlier in the day?',
    'For mornings, I have 9:00 AM on Tuesday and 10:30 AM on Thursday.',
  ],
  [
    'This is not working, can I speak to someone?',
    'I understand your frustration. Let me connect you with a staff member.',
  ],
];

const STAFF_NOTES = [
  'Customer seems frustrated — previous booking was lost. Handle with care.',
  'VIP customer, priority handling required.',
  'Referred by Dr. Tan, give complimentary first consultation.',
  'Follow up in 2 days if no response.',
  'Insurance details need to be verified before appointment.',
];

// ─── Named contacts ─────────────────────────────────────────────────
// Fixed IDs so interactions can reference them deterministically.

const SEED_CONTACTS = [
  // Staff (3)
  {
    id: 'c-staff-david',
    phone: '+6590001111',
    email: 'david@clinic.sg',
    name: 'David Lim',
    role: 'staff' as const,
    metadata: { department: 'operations' },
  },
  {
    id: 'c-staff-eve',
    phone: '+6590002222',
    email: 'eve@clinic.sg',
    name: 'Eve Chen',
    role: 'staff' as const,
    metadata: { department: 'management' },
  },
  {
    id: 'c-staff-frank',
    phone: '+6590003333',
    email: 'frank@clinic.sg',
    name: 'Frank Ng',
    role: 'staff' as const,
    metadata: { department: 'clinical' },
  },
  // Customers (12) — intentionally named so we can create multi-interaction timelines
  {
    id: 'c-alice',
    phone: '+6581110001',
    email: 'alice@example.com',
    name: 'Alice Tan',
    role: 'customer' as const,
    metadata: { source: 'whatsapp' },
  },
  {
    id: 'c-bob',
    phone: '+6581110002',
    email: 'bob@example.com',
    name: 'Bob Wong',
    role: 'customer' as const,
    metadata: { source: 'web' },
  },
  {
    id: 'c-charlie',
    phone: '+6581110003',
    email: 'charlie@example.com',
    name: 'Charlie Lee',
    role: 'customer' as const,
    metadata: { source: 'referral' },
  },
  {
    id: 'c-diana',
    phone: '+6581110004',
    email: 'diana@example.com',
    name: 'Diana Goh',
    role: 'customer' as const,
    metadata: { source: 'whatsapp' },
  },
  {
    id: 'c-edward',
    phone: '+6581110005',
    email: 'edward@example.com',
    name: 'Edward Lim',
    role: 'customer' as const,
    metadata: { source: 'web' },
  },
  {
    id: 'c-fiona',
    phone: '+6581110006',
    email: 'fiona@example.com',
    name: 'Fiona Yap',
    role: 'customer' as const,
    metadata: { source: 'walk-in' },
  },
  {
    id: 'c-george',
    phone: '+6581110007',
    email: 'george@example.com',
    name: 'George Ong',
    role: 'customer' as const,
    metadata: { source: 'whatsapp' },
  },
  {
    id: 'c-hannah',
    phone: '+6581110008',
    email: 'hannah@example.com',
    name: 'Hannah Koh',
    role: 'customer' as const,
    metadata: { source: 'web' },
  },
  {
    id: 'c-ivan',
    phone: '+6581110009',
    email: 'ivan@example.com',
    name: 'Ivan Chua',
    role: 'customer' as const,
    metadata: { source: 'referral' },
  },
  {
    id: 'c-jenny',
    phone: '+6581110010',
    email: 'jenny@example.com',
    name: 'Jenny Sim',
    role: 'customer' as const,
    metadata: { source: 'whatsapp' },
  },
  {
    id: 'c-kenny',
    phone: '+6581110011',
    email: 'kenny@example.com',
    name: 'Kenny Ng',
    role: 'customer' as const,
    metadata: { source: 'web' },
  },
  {
    id: 'c-lily',
    phone: '+6581110012',
    email: 'lily@example.com',
    name: 'Lily Ho',
    role: 'customer' as const,
    metadata: { source: 'walk-in' },
  },
  // Leads (5)
  {
    id: 'c-lead-mark',
    phone: '+6581120001',
    email: 'mark@example.com',
    name: 'Mark Teo',
    role: 'lead' as const,
    metadata: { source: 'google-ads', campaign: 'q2-booking' },
  },
  {
    id: 'c-lead-nina',
    phone: '+6581120002',
    email: 'nina@example.com',
    name: 'Nina Loh',
    role: 'lead' as const,
    metadata: { source: 'facebook', campaign: 'wellness' },
  },
  {
    id: 'c-lead-oscar',
    phone: '+6581120003',
    email: 'oscar@example.com',
    name: 'Oscar Pang',
    role: 'lead' as const,
    metadata: { source: 'instagram', campaign: 'promo' },
  },
  {
    id: 'c-lead-paula',
    phone: '+6581120004',
    email: 'paula@example.com',
    name: 'Paula Quek',
    role: 'lead' as const,
    metadata: { source: 'organic' },
  },
  {
    id: 'c-lead-ray',
    phone: '+6581120005',
    email: 'ray@example.com',
    name: 'Ray Soh',
    role: 'lead' as const,
    metadata: { source: 'referral' },
  },
];

const customers = SEED_CONTACTS.filter((c) => c.role === 'customer');
const staff = SEED_CONTACTS.filter((c) => c.role === 'staff');

// ─── Channel instances & routings ───────────────────────────────────

const SEED_CHANNEL_INSTANCES = [
  {
    id: 'ci-wa-main',
    type: 'whatsapp',
    label: 'WhatsApp Business',
    source: 'self' as const,
    config: {},
    status: 'active',
  },
  {
    id: 'ci-web',
    type: 'web',
    label: 'Website Chat',
    source: 'env' as const,
    config: {},
    status: 'active',
  },
  {
    id: 'ci-email',
    type: 'email',
    label: 'Support Email',
    source: 'self' as const,
    config: {},
    status: 'active',
  },
];

const SEED_CHANNEL_ROUTINGS = [
  {
    id: 'ep-wa-booking',
    name: 'WhatsApp Booking',
    channelInstanceId: 'ci-wa-main',
    agentId: 'booking',
    assignmentPattern: 'direct' as const,
    config: {},
    enabled: true,
  },
  {
    id: 'ep-web-booking',
    name: 'Web Chat Booking',
    channelInstanceId: 'ci-web',
    agentId: 'booking',
    assignmentPattern: 'direct' as const,
    config: {},
    enabled: true,
  },
  {
    id: 'ep-email-support',
    name: 'Email Support',
    channelInstanceId: 'ci-email',
    agentId: 'booking',
    assignmentPattern: 'direct' as const,
    config: {},
    enabled: true,
  },
];

// ─── Team IDs (referencing better-auth teams, seeded separately) ────

const TEAM_SALES = 'team-sales';
const TEAM_SUPPORT = 'team-support';

// ─── Interaction templates ──────────────────────────────────────────
// Handcrafted interactions covering every dimension of the model.

type InteractionSeed = {
  id: string;
  channelRoutingId: string;
  contactId: string;
  agentId: string;
  channelInstanceId: string;
  status: string;
  interactionType: string;
  startedAt: Date;
  resolvedAt?: Date;
  outcome?: string;
  autonomyLevel?: string;
  reopenCount?: number;
  topicChangePending?: boolean;
  mode?: string;
  assignee?: string | null;
  assignedAt?: Date | null;
  priority?: string;
  hasPendingEscalation?: boolean;
  waitingSince?: Date | null;
  unreadCount?: number;
  title?: string;
  metadata?: Record<string, unknown>;
};

const handcraftedInteractions: InteractionSeed[] = [
  // ════════════════════════════════════════════════════════════════════
  // ALICE — Hero contact #1: 10 dense WhatsApp interactions over 12 days
  // Shows a complete customer journey: new patient → regular → escalation → loyalty
  // ════════════════════════════════════════════════════════════════════
  {
    id: 'int-alice-wa-01',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-alice',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(288), // Day 1
    resolvedAt: hoursAgo(287),
    outcome: 'resolved',
    autonomyLevel: 'full_ai',
    title: 'First appointment inquiry',
    metadata: {},
  },
  {
    id: 'int-alice-wa-02',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-alice',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(264), // Day 2 (next morning)
    resolvedAt: hoursAgo(263),
    outcome: 'resolved',
    autonomyLevel: 'full_ai',
    title: 'Pre-visit questions',
    metadata: {},
  },
  {
    id: 'int-alice-wa-03',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-alice',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(216), // Day 4 (after visit)
    resolvedAt: hoursAgo(215),
    outcome: 'topic_change',
    autonomyLevel: 'full_ai',
    title: 'Post-visit feedback → billing question',
    metadata: {},
  },
  {
    id: 'int-alice-wa-04',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-alice',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(215), // Day 4 (right after topic change)
    resolvedAt: hoursAgo(212),
    outcome: 'escalated',
    autonomyLevel: 'ai_with_escalation',
    title: 'Insurance billing question',
    metadata: {},
  },
  {
    id: 'int-alice-wa-05',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-alice',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(168), // Day 6
    resolvedAt: hoursAgo(167),
    outcome: 'resolved',
    autonomyLevel: 'full_ai',
    reopenCount: 1,
    title: 'Reschedule follow-up appointment',
    metadata: {},
  },
  {
    id: 'int-alice-wa-06',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-alice',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(120), // Day 7
    resolvedAt: hoursAgo(119),
    outcome: 'resolved',
    autonomyLevel: 'full_ai',
    title: 'Parking and directions question',
    metadata: {},
  },
  {
    id: 'int-alice-wa-07',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-alice',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(72), // Day 9
    resolvedAt: hoursAgo(71),
    outcome: 'resolved',
    autonomyLevel: 'human_assisted',
    assignee: 'c-staff-david',
    title: 'Specialist referral request',
    metadata: {},
  },
  {
    id: 'int-alice-wa-08',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-alice',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(48), // Day 10
    resolvedAt: hoursAgo(47),
    outcome: 'resolved',
    autonomyLevel: 'full_ai',
    title: 'Specialist appointment confirmation',
    metadata: {},
  },
  {
    id: 'int-alice-wa-09',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-alice',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(8), // Day 12 (yesterday)
    resolvedAt: hoursAgo(7),
    outcome: 'topic_change',
    autonomyLevel: 'full_ai',
    title: 'Confirm specialist visit → asked about family plan',
    metadata: {},
  },
  {
    id: 'int-alice-wa-10',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-alice',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'active',
    interactionType: 'message',
    startedAt: hoursAgo(7), // Day 12 (still active, right after topic change)
    reopenCount: 1,
    mode: 'ai',
    title: 'Family wellness package inquiry',
    metadata: {},
  },

  // ════════════════════════════════════════════════════════════════════
  // BOB — Hero contact #2: 8 cross-channel interactions (Web + Email)
  // Complex scheduling needs, uses multiple channels, escalates twice
  // ════════════════════════════════════════════════════════════════════
  {
    id: 'int-bob-web-01',
    channelRoutingId: 'ep-web-booking',
    contactId: 'c-bob',
    agentId: 'booking',
    channelInstanceId: 'ci-web',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(240), // Day 1
    resolvedAt: hoursAgo(238),
    outcome: 'resolved',
    autonomyLevel: 'human_assisted',
    title: 'Multi-location booking request',
    metadata: {},
  },
  {
    id: 'int-bob-email-01',
    channelRoutingId: 'ep-email-support',
    contactId: 'c-bob',
    agentId: 'booking',
    channelInstanceId: 'ci-email',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(216), // Day 2 (followed up via email)
    resolvedAt: hoursAgo(192),
    outcome: 'resolved',
    autonomyLevel: 'full_ai',
    title: 'Email confirmation with CC to assistant',
    metadata: {},
  },
  {
    id: 'int-bob-web-02',
    channelRoutingId: 'ep-web-booking',
    contactId: 'c-bob',
    agentId: 'booking',
    channelInstanceId: 'ci-web',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(168), // Day 4
    resolvedAt: hoursAgo(167),
    outcome: 'resolved',
    autonomyLevel: 'full_ai',
    reopenCount: 1,
    title: 'Rescheduling Orchard appointment',
    metadata: {},
  },
  {
    id: 'int-bob-web-03',
    channelRoutingId: 'ep-web-booking',
    contactId: 'c-bob',
    agentId: 'booking',
    channelInstanceId: 'ci-web',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(120), // Day 6
    resolvedAt: hoursAgo(119),
    outcome: 'escalated',
    autonomyLevel: 'ai_with_escalation',
    title: 'Billing discrepancy for multi-branch',
    metadata: {},
  },
  {
    id: 'int-bob-email-02',
    channelRoutingId: 'ep-email-support',
    contactId: 'c-bob',
    agentId: 'booking',
    channelInstanceId: 'ci-email',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(96), // Day 7
    resolvedAt: hoursAgo(72),
    outcome: 'resolved',
    autonomyLevel: 'full_ai',
    title: 'Updated invoice via email',
    metadata: {},
  },
  {
    id: 'int-bob-web-04',
    channelRoutingId: 'ep-web-booking',
    contactId: 'c-bob',
    agentId: 'booking',
    channelInstanceId: 'ci-web',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(48), // Day 9
    resolvedAt: hoursAgo(47),
    outcome: 'resolved',
    autonomyLevel: 'full_ai',
    title: 'Pre-visit checklist question',
    metadata: {},
  },
  {
    id: 'int-bob-web-05',
    channelRoutingId: 'ep-web-booking',
    contactId: 'c-bob',
    agentId: 'booking',
    channelInstanceId: 'ci-web',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(12), // Day 11 (yesterday)
    resolvedAt: hoursAgo(11),
    outcome: 'topic_change',
    autonomyLevel: 'full_ai',
    title: 'Post-visit feedback → new booking',
    metadata: {},
  },
  {
    id: 'int-bob-web-06',
    channelRoutingId: 'ep-web-booking',
    contactId: 'c-bob',
    agentId: 'booking',
    channelInstanceId: 'ci-web',
    status: 'active',
    interactionType: 'message',
    startedAt: hoursAgo(11), // Day 11 (right after topic change)
    reopenCount: 2,
    mode: 'ai',
    title: 'Booking next quarterly checkup',
    metadata: {},
  },

  // ════════════════════════════════════════════════════════════════════
  // CHARLIE — VIP patient: 6 WhatsApp interactions, always gets staff
  // ════════════════════════════════════════════════════════════════════
  {
    id: 'int-charlie-wa-01',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-charlie',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(192), // Day 1
    resolvedAt: hoursAgo(190),
    outcome: 'resolved',
    autonomyLevel: 'human_only',
    assignee: 'c-staff-david',
    title: 'Monthly checkup booking',
    metadata: {},
  },
  {
    id: 'int-charlie-wa-02',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-charlie',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(144), // Day 3
    resolvedAt: hoursAgo(143),
    outcome: 'resolved',
    autonomyLevel: 'human_only',
    assignee: 'c-staff-david',
    title: 'Private room request for Thursday',
    metadata: {},
  },
  {
    id: 'int-charlie-wa-03',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-charlie',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(96), // Day 5
    resolvedAt: hoursAgo(95),
    outcome: 'resolved',
    autonomyLevel: 'human_assisted',
    title: 'Post-checkup results discussion',
    metadata: {},
  },
  {
    id: 'int-charlie-wa-04',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-charlie',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(48), // Day 7
    resolvedAt: hoursAgo(47),
    outcome: 'resolved',
    autonomyLevel: 'full_ai',
    reopenCount: 1,
    title: 'Prescription refill request',
    metadata: {},
  },
  {
    id: 'int-charlie-wa-05',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-charlie',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(12), // Day 9 (yesterday)
    resolvedAt: hoursAgo(11),
    outcome: 'resolved',
    autonomyLevel: 'human_only',
    assignee: 'c-staff-david',
    title: '90-minute session with Dr. Tan',
    metadata: {},
  },
  {
    id: 'int-charlie-wa-06',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-charlie',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'active',
    interactionType: 'message',
    startedAt: hoursAgo(2), // Today
    mode: 'human',
    assignee: 'c-staff-david',
    priority: 'high',
    title: 'Urgent follow-up on test results',
    metadata: {},
  },

  // ════════════════════════════════════════════════════════════════════
  // Remaining contacts — 1-2 interactions each for variety
  // ════════════════════════════════════════════════════════════════════

  // Diana: abandoned (went silent)
  {
    id: 'int-diana-wa-1',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-diana',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(72),
    resolvedAt: hoursAgo(48),
    outcome: 'abandoned',
    autonomyLevel: 'full_ai',
    title: 'Weekend appointment inquiry — no response',
    metadata: {},
  },

  // Edward: resolving state
  {
    id: 'int-edward-web-1',
    channelRoutingId: 'ep-web-booking',
    contactId: 'c-edward',
    agentId: 'booking',
    channelInstanceId: 'ci-web',
    status: 'resolving',
    interactionType: 'message',
    startedAt: hoursAgo(0.5),
    mode: 'ai',
    title: 'General checkup booking — wrapping up',
    metadata: {},
  },

  // Fiona: failed
  {
    id: 'int-fiona-web-1',
    channelRoutingId: 'ep-web-booking',
    contactId: 'c-fiona',
    agentId: 'booking',
    channelInstanceId: 'ci-web',
    status: 'failed',
    interactionType: 'message',
    startedAt: hoursAgo(24),
    mode: 'ai',
    title: 'Family block booking — agent crashed',
    metadata: { error: 'Agent exceeded max steps' },
  },

  // George: topicChangePending
  {
    id: 'int-george-wa-1',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-george',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(3),
    resolvedAt: hoursAgo(0.5),
    outcome: 'topic_change',
    autonomyLevel: 'full_ai',
    topicChangePending: true,
    title: 'Appointment confirmed → switching to physiotherapy inquiry',
    metadata: {},
  },

  // Hannah: human mode with escalation
  {
    id: 'int-hannah-web-1',
    channelRoutingId: 'ep-web-booking',
    contactId: 'c-hannah',
    agentId: 'booking',
    channelInstanceId: 'ci-web',
    status: 'active',
    interactionType: 'message',
    startedAt: hoursAgo(2),
    mode: 'human',
    hasPendingEscalation: true,
    waitingSince: hoursAgo(2),
    unreadCount: 3,
    title: 'Refund request for no-show appointment',
    metadata: {},
  },

  // Ivan: supervised mode
  {
    id: 'int-ivan-web-1',
    channelRoutingId: 'ep-web-booking',
    contactId: 'c-ivan',
    agentId: 'booking',
    channelInstanceId: 'ci-web',
    status: 'active',
    interactionType: 'message',
    startedAt: hoursAgo(1),
    mode: 'supervised',
    hasPendingEscalation: true,
    waitingSince: hoursAgo(1),
    unreadCount: 2,
    title: 'Corporate bulk booking — pending pricing approval',
    metadata: {},
  },

  // Jenny: held, urgent
  {
    id: 'int-jenny-wa-1',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-jenny',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'active',
    interactionType: 'message',
    startedAt: hoursAgo(3),
    mode: 'held',
    priority: 'urgent',
    waitingSince: hoursAgo(3),
    unreadCount: 0,
    title: 'Emergency — daughter injured',
    metadata: {},
  },

  // Kenny: email, recently resolved
  {
    id: 'int-kenny-email-1',
    channelRoutingId: 'ep-email-support',
    contactId: 'c-kenny',
    agentId: 'booking',
    channelInstanceId: 'ci-email',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(24),
    resolvedAt: hoursAgo(6),
    outcome: 'resolved',
    autonomyLevel: 'full_ai',
    title: 'Appointment confirmation email',
    metadata: {},
  },

  // Lily: 2 interactions (escalation story)
  {
    id: 'int-lily-web-1',
    channelRoutingId: 'ep-web-booking',
    contactId: 'c-lily',
    agentId: 'booking',
    channelInstanceId: 'ci-web',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(48),
    resolvedAt: hoursAgo(46),
    outcome: 'escalated',
    autonomyLevel: 'ai_with_escalation',
    title: 'Wait time complaint — escalated to management',
    metadata: {},
  },
  {
    id: 'int-lily-wa-1',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-lily',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'active',
    interactionType: 'message',
    startedAt: hoursAgo(0.5),
    mode: 'human',
    priority: 'high',
    hasPendingEscalation: true,
    waitingSince: hoursAgo(0.5),
    unreadCount: 5,
    title: 'Follow-up — management never called back',
    metadata: {},
  },

  // Leads
  {
    id: 'int-lead-mark-1',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-lead-mark',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(120),
    resolvedAt: hoursAgo(119),
    outcome: 'resolved',
    autonomyLevel: 'full_ai',
    title: 'New patient promo inquiry',
    metadata: {},
  },
  {
    id: 'int-lead-nina-1',
    channelRoutingId: 'ep-web-booking',
    contactId: 'c-lead-nina',
    agentId: 'booking',
    channelInstanceId: 'ci-web',
    status: 'active',
    interactionType: 'message',
    startedAt: hoursAgo(4),
    mode: 'ai',
    title: 'Corporate wellness package inquiry',
    metadata: {},
  },
  {
    id: 'int-lead-oscar-1',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-lead-oscar',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'resolved',
    interactionType: 'message',
    startedAt: hoursAgo(200),
    resolvedAt: hoursAgo(198),
    outcome: 'abandoned',
    autonomyLevel: 'full_ai',
    title: 'Instagram promo inquiry — no follow-up',
    metadata: {},
  },
];

// ─── Bulk random interactions ───────────────────────────────────────
// Fill to ~90 total to populate lists and charts.

function generateBulkInteractions(count: number): InteractionSeed[] {
  const allCustomers = [
    ...customers,
    ...SEED_CONTACTS.filter((c) => c.role === 'lead'),
  ];
  const routings = SEED_CHANNEL_ROUTINGS.filter((r) => r.enabled);
  const items: InteractionSeed[] = [];

  const TITLES = [
    'Appointment booking inquiry',
    'Reschedule request',
    'New patient registration',
    'Follow-up consultation',
    'Cancellation request',
    'Group booking inquiry',
    'Insurance verification',
    'Specialist referral',
    'Feedback & review',
    'Walk-in availability check',
  ];

  for (let i = 0; i < count; i++) {
    const routing = pick(routings);
    const contact = pick(allCustomers);
    const startH = faker.number.int({ min: 6, max: 720 });

    const status = faker.helpers.weightedArrayElement([
      { value: 'resolved', weight: 55 },
      { value: 'active', weight: 25 },
      { value: 'failed', weight: 15 },
      { value: 'resolving', weight: 5 },
    ]);

    const startedAt = hoursAgo(startH);
    const resolvedAt =
      status === 'resolved'
        ? hoursAgo(startH - faker.number.int({ min: 0, max: 4 }))
        : undefined;

    const outcome =
      status === 'resolved'
        ? faker.helpers.weightedArrayElement([
            { value: 'resolved', weight: 60 },
            { value: 'escalated', weight: 20 },
            { value: 'abandoned', weight: 15 },
            { value: 'topic_change', weight: 5 },
          ])
        : undefined;

    const autonomyLevel =
      status === 'resolved'
        ? faker.helpers.weightedArrayElement([
            { value: 'full_ai', weight: 60 },
            { value: 'ai_with_escalation', weight: 20 },
            { value: 'human_assisted', weight: 15 },
            { value: 'human_only', weight: 5 },
          ])
        : undefined;

    const reopenCount =
      status !== 'failed'
        ? faker.helpers.weightedArrayElement([
            { value: 0, weight: 75 },
            { value: 1, weight: 15 },
            { value: 2, weight: 7 },
            { value: 3, weight: 3 },
          ])
        : 0;

    items.push({
      id: `int-bulk-${faker.string.alphanumeric(8)}`,
      channelRoutingId: routing.id,
      contactId: contact.id,
      agentId: 'booking',
      channelInstanceId: routing.channelInstanceId,
      status,
      interactionType: 'message',
      startedAt,
      ...(resolvedAt && { resolvedAt }),
      ...(outcome && { outcome }),
      ...(autonomyLevel && { autonomyLevel }),
      reopenCount,
      ...(faker.datatype.boolean(0.6) && { title: pick(TITLES) }),
      metadata:
        status === 'failed'
          ? {
              error: pick([
                'Agent exceeded max steps',
                'Memory thread creation failed',
                'Unhandled tool error',
                'Context window exceeded',
              ]),
            }
          : {},
    });
  }

  return items;
}

// ─── Seed function ──────────────────────────────────────────────────

export default async function seed(ctx: { db: VobaseDb }) {
  const { db } = ctx;

  // ─── Contacts ────────────────────────────────────────────────────
  await db.insert(contacts).values(SEED_CONTACTS).onConflictDoNothing();
  console.log(`${green('✓')} Seeded ${SEED_CONTACTS.length} contacts`);

  // ─── Channel Instances ───────────────────────────────────────────
  await db
    .insert(channelInstances)
    .values(SEED_CHANNEL_INSTANCES)
    .onConflictDoNothing();

  // ─── Channel Routings ────────────────────────────────────────────
  await db
    .insert(channelRoutings)
    .values(SEED_CHANNEL_ROUTINGS)
    .onConflictDoNothing();

  // ─── Channel Instance Teams ──────────────────────────────────────
  // WhatsApp + Email visible to support team; Web visible to both teams
  const seedChannelInstanceTeams = [
    { channelInstanceId: 'ci-wa-main', teamId: TEAM_SUPPORT },
    { channelInstanceId: 'ci-email', teamId: TEAM_SUPPORT },
    { channelInstanceId: 'ci-web', teamId: TEAM_SUPPORT },
    { channelInstanceId: 'ci-web', teamId: TEAM_SALES },
  ];
  await db
    .insert(channelInstanceTeams)
    .values(seedChannelInstanceTeams)
    .onConflictDoNothing();
  console.log(
    `${green('✓')} Seeded ${seedChannelInstanceTeams.length} channel-instance-team mappings`,
  );

  // ─── Interactions ────────────────────────────────────────────────
  const bulkInteractions = generateBulkInteractions(65);
  const allInteractions = [...handcraftedInteractions, ...bulkInteractions];
  const BATCH_SIZE = 50;

  for (let i = 0; i < allInteractions.length; i += BATCH_SIZE) {
    await db
      .insert(interactions)
      .values(allInteractions.slice(i, i + BATCH_SIZE))
      .onConflictDoNothing();
  }
  console.log(
    `${green('✓')} Seeded ${allInteractions.length} interactions (${handcraftedInteractions.length} handcrafted + ${bulkInteractions.length} bulk)`,
  );

  // ─── Interaction Participants ────────────────────────────────────
  // Every interaction gets its primary contact as initiator.
  // Some get additional participants (CC, BCC for email; participant for group).
  const seedParticipants: Array<{
    id: string;
    interactionId: string;
    contactId: string;
    role: string;
    joinedAt: Date;
  }> = [];

  // All handcrafted interactions get initiator
  for (const int of handcraftedInteractions) {
    seedParticipants.push({
      id: `part-${int.id}-init`,
      interactionId: int.id,
      contactId: int.contactId,
      role: 'initiator',
      joinedAt: int.startedAt,
    });
  }

  // Bob's email interaction has CC and BCC
  seedParticipants.push(
    {
      id: 'part-bob-email-cc',
      interactionId: 'int-bob-email-01',
      contactId: 'c-alice',
      role: 'cc',
      joinedAt: hoursAgo(216),
    },
    {
      id: 'part-bob-email-bcc',
      interactionId: 'int-bob-email-01',
      contactId: 'c-staff-eve',
      role: 'bcc',
      joinedAt: hoursAgo(216),
    },
  );

  // Hannah's escalation has a staff participant
  seedParticipants.push({
    id: 'part-hannah-staff',
    interactionId: 'int-hannah-web-1',
    contactId: 'c-staff-david',
    role: 'participant',
    joinedAt: hoursAgo(1.5),
  });

  // Corporate inquiry has multiple participants
  seedParticipants.push(
    {
      id: 'part-nina-init',
      interactionId: 'int-lead-nina-1',
      contactId: 'c-lead-nina',
      role: 'initiator',
      joinedAt: hoursAgo(4),
    },
    {
      id: 'part-nina-cc',
      interactionId: 'int-lead-nina-1',
      contactId: 'c-lead-paula',
      role: 'cc',
      joinedAt: hoursAgo(3.5),
    },
  );

  await db
    .insert(interactionParticipants)
    .values(seedParticipants)
    .onConflictDoNothing();
  console.log(
    `${green('✓')} Seeded ${seedParticipants.length} interaction participants`,
  );

  // ─── Messages ────────────────────────────────────────────────────
  type SeedMessage = {
    id: string;
    interactionId: string;
    messageType: 'incoming' | 'outgoing';
    contentType: 'text';
    content: string;
    channelType: string;
    externalMessageId?: string;
    status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | null;
    failureReason?: string;
    senderId: string;
    senderType: 'contact' | 'agent' | 'user';
    private?: boolean;
    createdAt: Date;
  };

  const seedMessages: SeedMessage[] = [];

  for (const int of allInteractions) {
    const channelType =
      int.channelInstanceId === 'ci-wa-main'
        ? 'whatsapp'
        : int.channelInstanceId === 'ci-email'
          ? 'email'
          : 'web';

    // Use scripted turns if available, otherwise random generic turns
    const script = SCRIPTED[int.id];
    const turns: Array<[string, string]> = script
      ? script
      : [...GENERIC_TURNS]
          .sort(() => faker.number.float() - 0.5)
          .slice(0, faker.number.int({ min: 2, max: 5 }));

    for (let t = 0; t < turns.length; t++) {
      const [customerMsg, agentMsg] = turns[t];
      const baseH = (int.startedAt.getTime() - Date.now()) / (-1000 * 60 * 60);
      // Space turns ~6 min apart; scripted interactions get slightly wider gaps for readability
      const gap = script ? 0.15 : 0.1;
      const customerTime = hoursAgo(Math.max(0, baseH - t * gap));
      const agentTime = hoursAgo(Math.max(0, baseH - t * gap - 0.03));

      const isLastTurn = t === turns.length - 1;
      let agentStatus: SeedMessage['status'];
      if (int.status === 'resolved') {
        agentStatus = pick(['delivered', 'read'] as const);
      } else if (int.status === 'failed' && isLastTurn) {
        agentStatus = 'failed';
      } else if (int.status === 'active' && isLastTurn) {
        agentStatus = pick(['queued', 'sent'] as const);
      } else {
        agentStatus = 'delivered';
      }

      const hasExtId = agentStatus !== 'queued' && agentStatus !== 'failed';
      const prefix =
        channelType === 'whatsapp'
          ? 'wamid'
          : channelType === 'email'
            ? 'emlid'
            : 'web';

      seedMessages.push({
        id: `msg-${faker.string.alphanumeric(10)}`,
        interactionId: int.id,
        messageType: 'incoming',
        contentType: 'text',
        content: customerMsg,
        channelType,
        externalMessageId: `${prefix}.in.${faker.string.alphanumeric(12)}`,
        status: null,
        senderId: int.contactId,
        senderType: 'contact',
        createdAt: customerTime,
      });

      seedMessages.push({
        id: `msg-${faker.string.alphanumeric(10)}`,
        interactionId: int.id,
        messageType: 'outgoing',
        contentType: 'text',
        content: agentMsg,
        channelType,
        ...(hasExtId && {
          externalMessageId: `${prefix}.out.${faker.string.alphanumeric(12)}`,
        }),
        status: agentStatus,
        ...(agentStatus === 'failed' && {
          failureReason: 'Max retries exceeded',
        }),
        senderId: 'agent-booking',
        senderType: 'agent',
        createdAt: agentTime,
      });

      // 10% chance of a staff private note (only on non-scripted interactions)
      if (!script && faker.number.float() < 0.1) {
        seedMessages.push({
          id: `msg-${faker.string.alphanumeric(10)}`,
          interactionId: int.id,
          messageType: 'outgoing',
          contentType: 'text',
          content: pick(STAFF_NOTES),
          channelType,
          status: null,
          senderId: 'staff-admin',
          senderType: 'user',
          private: true,
          createdAt: new Date(agentTime.getTime() + 30_000),
        });
      }
    }
  }

  // Dead letter messages (failed outgoing)
  const DL_ERRORS = [
    'WhatsApp Cloud API error 131026: recipient phone number not on WhatsApp',
    'WhatsApp Cloud API error 130429: rate limit exceeded, retry after 3600s',
    'WhatsApp Cloud API error 131047: 24-hour message window expired',
    'SMTP: mailbox unavailable — user unknown',
    'Connection timeout after 30000ms',
  ];

  const resolvedInts = allInteractions.filter((s) => s.status === 'resolved');
  const seedDeadLetters = DL_ERRORS.map((error, i) => {
    const int = resolvedInts[i] ?? allInteractions[i];
    const chType = i < 3 ? 'whatsapp' : 'email';
    return {
      id: `msg-dl-${faker.string.alphanumeric(8)}`,
      interactionId: int.id,
      messageType: 'outgoing' as const,
      contentType: 'text' as const,
      content: 'Your appointment is confirmed for next week.',
      channelType: chType,
      status: 'failed' as const,
      failureReason: error,
      senderId: 'agent-booking',
      senderType: 'agent' as const,
      private: false,
      createdAt: hoursAgo(faker.number.int({ min: 24, max: 500 })),
    };
  });

  const allMessages = [...seedMessages, ...seedDeadLetters];
  for (let i = 0; i < allMessages.length; i += BATCH_SIZE) {
    await db
      .insert(messages)
      .values(allMessages.slice(i, i + BATCH_SIZE))
      .onConflictDoNothing();
  }
  console.log(`${green('✓')} Seeded ${allMessages.length} messages`);

  // ─── Consultations ───────────────────────────────────────────────

  const CONSULTATION_REASONS = [
    'Customer requesting special pricing for a package deal.',
    'Customer asked about group booking policy.',
    'Complex scheduling conflict — needs manual resolution.',
    'Customer wants to book outside normal operating hours.',
    'Customer requesting refund for no-show appointment.',
    'VIP customer — needs priority scheduling.',
    'Insurance billing question beyond agent knowledge.',
    'Customer complaint about wait times.',
    'Multi-location booking across branches.',
    'Corporate wellness package inquiry — needs manager approval.',
    'Customer requesting home visit service.',
    'Accessibility requirements for appointment venue.',
  ];

  const REPLY_SUMMARIES = [
    'Approved with 10% discount. Manager confirmed.',
    'Rescheduled to next available slot. Customer satisfied.',
    'Referred to billing department for follow-up.',
    'Special accommodation arranged. Notes added to file.',
  ];

  const activeInts = allInteractions.filter((s) => s.status === 'active');
  const failedInts = allInteractions.filter((s) => s.status === 'failed');

  const seedConsultations: Array<{
    id: string;
    interactionId: string;
    staffContactId: string;
    channelType: string;
    channelInstanceId?: string;
    reason: string;
    summary?: string;
    status: string;
    timeoutMinutes: number;
    requestedAt: Date;
    repliedAt?: Date;
    replyPayload?: Record<string, unknown>;
  }> = [];

  // Pending (from active)
  for (let i = 0; i < Math.min(3, activeInts.length); i++) {
    const int = activeInts[i];
    seedConsultations.push({
      id: `consult-pend-${i}`,
      interactionId: int.id,
      staffContactId: pick(staff).id,
      channelType: int.channelInstanceId === 'ci-wa-main' ? 'whatsapp' : 'web',
      channelInstanceId: int.channelInstanceId,
      reason: CONSULTATION_REASONS[i],
      status: 'pending',
      timeoutMinutes: 30,
      requestedAt: hoursAgo(faker.number.int({ min: 0, max: 1 })),
    });
  }

  // Replied (from resolved)
  for (let i = 0; i < Math.min(4, resolvedInts.length); i++) {
    const int = resolvedInts[i];
    const reqH = faker.number.int({ min: 24, max: 200 });
    seedConsultations.push({
      id: `consult-replied-${i}`,
      interactionId: int.id,
      staffContactId: pick(staff).id,
      channelType: int.channelInstanceId === 'ci-wa-main' ? 'whatsapp' : 'web',
      channelInstanceId: int.channelInstanceId,
      reason: CONSULTATION_REASONS[3 + i],
      summary: REPLY_SUMMARIES[i],
      status: 'replied',
      timeoutMinutes: 30,
      requestedAt: hoursAgo(reqH),
      repliedAt: hoursAgo(reqH - faker.number.int({ min: 0, max: 1 })),
      replyPayload: { reply: REPLY_SUMMARIES[i], staffId: pick(staff).id },
    });
  }

  // Timeout
  for (let i = 0; i < Math.min(2, resolvedInts.length - 4); i++) {
    const int = resolvedInts[4 + i];
    if (!int) break;
    seedConsultations.push({
      id: `consult-timeout-${i}`,
      interactionId: int.id,
      staffContactId: pick(staff).id,
      channelType: 'whatsapp',
      channelInstanceId: 'ci-wa-main',
      reason: CONSULTATION_REASONS[7 + i],
      status: 'timeout',
      timeoutMinutes: 30,
      requestedAt: hoursAgo(faker.number.int({ min: 48, max: 200 })),
    });
  }

  // Notification failed
  for (let i = 0; i < Math.min(2, failedInts.length); i++) {
    const int = failedInts[i];
    seedConsultations.push({
      id: `consult-notif-fail-${i}`,
      interactionId: int.id,
      staffContactId: pick(staff).id,
      channelType: 'whatsapp',
      channelInstanceId: 'ci-wa-main',
      reason: CONSULTATION_REASONS[9 + i],
      status: 'notification_failed',
      timeoutMinutes: 30,
      requestedAt: hoursAgo(faker.number.int({ min: 4, max: 72 })),
    });
  }

  if (seedConsultations.length > 0) {
    await db
      .insert(consultations)
      .values(seedConsultations)
      .onConflictDoNothing();
  }
  console.log(`${green('✓')} Seeded ${seedConsultations.length} consultations`);

  // ─── Activity Events (as messages with messageType='activity') ────

  type ActivitySeed = {
    type: string;
    agentId?: string;
    userId?: string;
    source: 'agent' | 'staff' | 'system';
    contactId?: string;
    interactionId: string;
    channelRoutingId?: string;
    channelType?: string;
    data: Record<string, unknown>;
    resolutionStatus?: 'pending' | 'reviewed' | 'dismissed';
    createdAt: Date;
  };

  function eventContent(evt: ActivitySeed): string {
    switch (evt.type) {
      case 'escalation.created':
        return `Escalation created: ${(evt.data.reason as string) ?? 'No reason'}`;
      case 'guardrail.block':
        return `Guardrail blocked: ${(evt.data.reason as string) ?? 'Policy violation'}`;
      case 'guardrail.warn':
        return `Guardrail warning: ${(evt.data.reason as string) ?? 'Policy warning'}`;
      case 'interaction.created':
        return 'Interaction started';
      case 'interaction.resolved':
        return `Interaction resolved${evt.data.outcome ? `: ${evt.data.outcome}` : ''}`;
      case 'interaction.reopened':
        return `Interaction reopened (reopen #${evt.data.reopenCount ?? 1})`;
      case 'interaction.failed':
        return `Interaction failed: ${(evt.data.reason as string) ?? 'Unknown error'}`;
      case 'agent.tool_executed':
        return `Tool executed: ${(evt.data.toolName as string) ?? 'unknown'}`;
      case 'handler.changed':
        return `Handler changed from ${evt.data.from} to ${evt.data.to}`;
      case 'agent.draft_generated':
        return 'Agent draft generated for review';
      default:
        return evt.type;
    }
  }

  function eventSenderType(
    source: 'agent' | 'staff' | 'system',
  ): 'agent' | 'user' | 'system' {
    if (source === 'agent') return 'agent';
    if (source === 'staff') return 'user';
    return 'system';
  }

  const seedActivity: ActivitySeed[] = [
    // Escalation events
    {
      type: 'escalation.created',
      agentId: 'booking',
      source: 'agent',
      contactId: 'c-hannah',
      interactionId: 'int-hannah-web-1',
      channelRoutingId: 'ep-web-booking',
      channelType: 'web',
      data: {
        reason: 'Customer requesting refund',
        staffContactId: 'c-staff-david',
      },
      resolutionStatus: 'pending',
      createdAt: hoursAgo(1.8),
    },
    {
      type: 'escalation.created',
      agentId: 'booking',
      source: 'agent',
      contactId: 'c-ivan',
      interactionId: 'int-ivan-web-1',
      channelRoutingId: 'ep-web-booking',
      channelType: 'web',
      data: { reason: 'Needs manager approval for discount' },
      resolutionStatus: 'pending',
      createdAt: hoursAgo(0.8),
    },
    // Guardrail events
    {
      type: 'guardrail.block',
      agentId: 'booking',
      source: 'system',
      contactId: 'c-jenny',
      interactionId: 'int-jenny-wa-1',
      channelRoutingId: 'ep-wa-booking',
      channelType: 'whatsapp',
      data: { reason: 'Blocked offensive content', matchedTerm: 'profanity' },
      resolutionStatus: 'pending',
      createdAt: hoursAgo(2.5),
    },
    {
      type: 'guardrail.warn',
      agentId: 'booking',
      source: 'system',
      contactId: 'c-lily',
      interactionId: 'int-lily-wa-1',
      channelType: 'whatsapp',
      data: { reason: 'Potential PII detected', matchedTerm: 'NRIC' },
      createdAt: hoursAgo(0.3),
    },
    // Reviewed escalation (from Alice's second interaction)
    {
      type: 'escalation.created',
      agentId: 'booking',
      source: 'agent',
      contactId: 'c-alice',
      interactionId: 'int-alice-wa-04',
      channelRoutingId: 'ep-wa-booking',
      channelType: 'whatsapp',
      data: { reason: 'Insurance billing question' },
      resolutionStatus: 'reviewed',
      createdAt: hoursAgo(335),
    },
    // Lifecycle events
    {
      type: 'interaction.created',
      agentId: 'booking',
      source: 'system',
      contactId: 'c-alice',
      interactionId: 'int-alice-wa-10',
      channelRoutingId: 'ep-wa-booking',
      channelType: 'whatsapp',
      data: {},
      createdAt: hoursAgo(2),
    },
    {
      type: 'interaction.reopened',
      agentId: 'booking',
      source: 'system',
      interactionId: 'int-alice-wa-10',
      data: { reopenCount: 1 },
      createdAt: hoursAgo(1),
    },
    {
      type: 'interaction.resolved',
      agentId: 'booking',
      source: 'system',
      interactionId: 'int-alice-wa-01',
      data: { outcome: 'resolved' },
      createdAt: hoursAgo(503),
    },
    {
      type: 'interaction.resolved',
      agentId: 'booking',
      source: 'system',
      interactionId: 'int-george-wa-1',
      data: { outcome: 'topic_change' },
      createdAt: hoursAgo(0.5),
    },
    {
      type: 'interaction.failed',
      agentId: 'booking',
      source: 'system',
      interactionId: 'int-fiona-web-1',
      data: { reason: 'Agent exceeded max steps' },
      createdAt: hoursAgo(47),
    },
    // Tool execution events
    {
      type: 'agent.tool_executed',
      agentId: 'booking',
      source: 'agent',
      contactId: 'c-alice',
      interactionId: 'int-alice-wa-10',
      channelType: 'whatsapp',
      data: { toolName: 'book_slot', isError: false },
      createdAt: hoursAgo(1.5),
    },
    {
      type: 'agent.tool_executed',
      agentId: 'booking',
      source: 'agent',
      contactId: 'c-bob',
      interactionId: 'int-bob-web-06',
      channelType: 'web',
      data: { toolName: 'check_availability', isError: false },
      createdAt: hoursAgo(0.8),
    },
    // Handler mode changes
    {
      type: 'handler.changed',
      agentId: 'booking',
      source: 'agent',
      interactionId: 'int-hannah-web-1',
      data: {
        from: 'ai',
        to: 'human',
        reason: 'Customer requested human agent',
      },
      createdAt: hoursAgo(1.9),
    },
    // Supervised draft
    {
      type: 'agent.draft_generated',
      agentId: 'booking',
      source: 'agent',
      interactionId: 'int-ivan-web-1',
      channelType: 'web',
      data: {
        handlerMode: 'supervised',
        draftContent: 'Here is your appointment confirmation for Monday 10am.',
      },
      resolutionStatus: 'pending',
      createdAt: hoursAgo(0.5),
    },
  ];

  const seedActivityMessages = seedActivity.map((evt, i) => ({
    id: `msg-evt-${faker.string.alphanumeric(8)}-${i}`,
    interactionId: evt.interactionId,
    messageType: 'activity' as const,
    contentType: 'system' as const,
    content: eventContent(evt),
    contentData: { ...evt.data, eventType: evt.type },
    senderId: evt.agentId ?? evt.userId ?? 'system',
    senderType: eventSenderType(evt.source),
    channelType: evt.channelType ?? null,
    resolutionStatus: evt.resolutionStatus ?? null,
    createdAt: evt.createdAt,
  }));

  if (seedActivityMessages.length > 0) {
    for (let i = 0; i < seedActivityMessages.length; i += BATCH_SIZE) {
      await db
        .insert(messages)
        .values(seedActivityMessages.slice(i, i + BATCH_SIZE))
        .onConflictDoNothing();
    }
  }

  // ─── Update last-message denormalized columns ────────────────────
  const allMsgs = [...allMessages, ...seedActivityMessages];
  const lastRealByInt = new Map<string, (typeof allMsgs)[number]>();
  const lastActivityByInt = new Map<string, (typeof allMsgs)[number]>();

  for (const msg of allMsgs) {
    if (msg.messageType === 'activity') {
      const existing = lastActivityByInt.get(msg.interactionId);
      if (!existing || msg.createdAt > existing.createdAt) {
        lastActivityByInt.set(msg.interactionId, msg);
      }
    } else if (!('private' in msg && msg.private)) {
      const existing = lastRealByInt.get(msg.interactionId);
      if (!existing || msg.createdAt > existing.createdAt) {
        lastRealByInt.set(msg.interactionId, msg);
      }
    }
  }

  const allIntIds = new Set([
    ...lastRealByInt.keys(),
    ...lastActivityByInt.keys(),
  ]);

  for (const intId of allIntIds) {
    const lastReal = lastRealByInt.get(intId);
    const lastActivity = lastActivityByInt.get(intId);
    const display = lastReal ?? lastActivity;
    if (!display) continue;

    await db
      .update(interactions)
      .set({
        lastMessageContent: display.content.slice(0, 100),
        lastMessageAt: display.createdAt,
        lastMessageType: display.messageType,
        lastActivityAt: lastActivity?.createdAt ?? display.createdAt,
      })
      .where(eq(interactions.id, intId));
  }

  console.log(
    `${green('✓')} Seeded ${seedActivityMessages.length} activity events`,
  );

  // ─── Channel Sessions (WhatsApp window tracking) ─────────────────
  const waActiveInts = allInteractions.filter(
    (s) => s.channelInstanceId === 'ci-wa-main' && s.status === 'active',
  );
  const seedSessions = waActiveInts.slice(0, 8).map((int, i) => {
    const isExpired = i >= 6;
    const windowOpensAt = hoursAgo(isExpired ? 30 : 2);
    return {
      id: `cs-${faker.string.alphanumeric(8)}`,
      interactionId: int.id,
      channelInstanceId: 'ci-wa-main',
      channelType: 'whatsapp',
      sessionState: isExpired ? 'window_expired' : 'window_open',
      windowOpensAt,
      windowExpiresAt: new Date(windowOpensAt.getTime() + 24 * 60 * 60 * 1000),
      metadata: {},
    };
  });

  if (seedSessions.length > 0) {
    await db.insert(channelSessions).values(seedSessions).onConflictDoNothing();
  }
  console.log(`${green('✓')} Seeded ${seedSessions.length} channel sessions`);

  // ─── Contact working memory ──────────────────────────────────────
  const WORKING_MEMORIES: Record<string, string> = {
    'c-alice':
      'Preferred language: English. Last booking: Wednesday 2 PM general consultation. Prefers afternoon slots. Has been reopened before — recurring customer.',
    'c-bob':
      'Uses both web and email. Complex scheduling needs. Previously required human assistance.',
    'c-charlie':
      'VIP customer. Always handled by David (staff). Priority scheduling.',
    'c-diana':
      'Tends to go silent mid-conversation. Follow up proactively if no response within 2 hours.',
    'c-lead-nina':
      'Corporate wellness inquiry. Budget-conscious. Needs group booking for 20+ employees.',
  };

  for (const [contactId, memory] of Object.entries(WORKING_MEMORIES)) {
    await db
      .update(contacts)
      .set({
        workingMemory: memory,
        resourceMetadata: {
          lastInteraction: hoursAgo(
            faker.number.int({ min: 1, max: 48 }),
          ).toISOString(),
          interactionCount: faker.number.int({ min: 1, max: 10 }),
        },
      })
      .where(eq(contacts.id, contactId));
  }
  console.log(
    `${green('✓')} Seeded working memory for ${Object.keys(WORKING_MEMORIES).length} contacts`,
  );

  // ─── Reactions + Feedback ────────────────────────────────────────
  // A few reactions and feedback entries for UI testing
  const reactionMessages = seedMessages.filter(
    (m) => m.senderType === 'agent' && m.status === 'delivered',
  );

  const seedReactions = reactionMessages.slice(0, 5).map((msg, i) => ({
    id: `react-${faker.string.alphanumeric(8)}`,
    messageId: msg.id,
    interactionId: msg.interactionId,
    contactId: allInteractions.find((s) => s.id === msg.interactionId)
      ?.contactId,
    userId: null,
    emoji: pick(['👍', '❤️', '😊', '🙏', '✅']),
    createdAt: new Date(msg.createdAt.getTime() + 60_000 * (i + 1)),
  }));

  if (seedReactions.length > 0) {
    await db.insert(reactions).values(seedReactions).onConflictDoNothing();
  }

  const seedFeedback = reactionMessages.slice(5, 10).map((msg, i) => ({
    id: `fb-${faker.string.alphanumeric(8)}`,
    interactionId: msg.interactionId,
    messageId: msg.id,
    rating: i < 3 ? 'positive' : 'negative',
    reason:
      i >= 3
        ? pick(['Unhelpful response', 'Wrong information', 'Too slow'])
        : null,
    contactId: allInteractions.find((s) => s.id === msg.interactionId)
      ?.contactId,
    userId: null,
  }));

  if (seedFeedback.length > 0) {
    await db.insert(messageFeedback).values(seedFeedback).onConflictDoNothing();
  }
  console.log(
    `${green('✓')} Seeded ${seedReactions.length} reactions, ${seedFeedback.length} feedback`,
  );

  // ─── Eval Runs ───────────────────────────────────────────────────
  faker.seed(99);

  const bookingQAPairs = [
    {
      input: 'Can I book an appointment for next Monday at 10am?',
      output:
        'I can check availability for Monday at 10am. Let me look that up for you.',
      context: [
        'You are a booking assistant.',
        'Available slots managed via check-availability tool.',
      ],
    },
    {
      input: 'I need to reschedule my appointment from Tuesday to Thursday.',
      output: "I'll help you reschedule. Let me check Thursday availability.",
      context: ['You are a booking assistant.', 'Use reschedule-booking tool.'],
    },
    {
      input: 'What services do you offer?',
      output:
        'We offer haircuts, coloring, styling, and treatments. Would you like to book?',
      context: [
        'You are a booking assistant for a hair salon.',
        'Services: haircut ($30), coloring ($80).',
      ],
    },
    {
      input: 'Cancel my appointment please.',
      output: "I'll cancel your upcoming appointment right away.",
      context: ['You are a booking assistant.', 'Use cancel-booking tool.'],
    },
    {
      input: 'Do you have any availability this weekend?',
      output: 'Let me check our weekend slots for you.',
      context: [
        'You are a booking assistant.',
        'Weekend: Saturday 9am-5pm, Sunday closed.',
      ],
    },
    {
      input: 'How much does a haircut cost?',
      output:
        'A standard haircut is $30. Premium cuts at $45 include wash and style.',
      context: [
        'Hair salon booking assistant.',
        'Standard $30, premium $45, kids $20.',
      ],
    },
  ];

  function makeEvalItems(
    pairs: typeof bookingQAPairs,
    range: [number, number],
  ) {
    return pairs.map((p) => ({
      ...p,
      scores: {
        'answer-relevancy-scorer':
          Math.round(
            faker.number.float({ min: range[0], max: range[1] }) * 100,
          ) / 100,
        'faithfulness-scorer':
          Math.round(
            faker.number.float({ min: range[0], max: range[1] }) * 100,
          ) / 100,
      },
    }));
  }

  const seedEvalRuns = [
    {
      id: 'eval-001',
      agentId: 'booking',
      status: 'complete' as const,
      itemCount: 6,
      results: JSON.stringify(makeEvalItems(bookingQAPairs, [0.82, 0.97])),
      createdAt: hoursAgo(7 * 24),
      completedAt: hoursAgo(7 * 24),
    },
    {
      id: 'eval-002',
      agentId: 'booking',
      status: 'complete' as const,
      itemCount: 4,
      results: JSON.stringify(
        makeEvalItems(bookingQAPairs.slice(0, 4), [0.58, 0.78]),
      ),
      createdAt: hoursAgo(5 * 24),
      completedAt: hoursAgo(5 * 24),
    },
    {
      id: 'eval-003',
      agentId: 'booking',
      status: 'complete' as const,
      itemCount: 6,
      results: JSON.stringify(makeEvalItems(bookingQAPairs, [0.85, 0.99])),
      createdAt: hoursAgo(2 * 24),
      completedAt: hoursAgo(2 * 24),
    },
    {
      id: 'eval-004',
      agentId: 'booking',
      status: 'running' as const,
      itemCount: 3,
      results: null,
      createdAt: hoursAgo(1),
      completedAt: null,
    },
    {
      id: 'eval-005',
      agentId: 'booking',
      status: 'pending' as const,
      itemCount: 5,
      results: null,
      createdAt: hoursAgo(0.25),
      completedAt: null,
    },
    {
      id: 'eval-006',
      agentId: 'booking',
      status: 'error' as const,
      itemCount: 6,
      results: null,
      errorMessage: 'Scorer API rate limit exceeded — retry after 60s',
      createdAt: hoursAgo(3 * 24),
      completedAt: hoursAgo(3 * 24),
    },
  ];

  await db.insert(aiEvalRuns).values(seedEvalRuns).onConflictDoNothing();
  faker.seed(42);
  console.log(`${green('✓')} Seeded ${seedEvalRuns.length} eval runs`);

  // ─── Custom Scorers ──────────────────────────────────────────────
  const seedScorers = [
    {
      id: 'scorer-policy',
      name: 'Policy Compliance',
      description: 'Checks response follows booking/cancellation policies',
      criteria:
        'Evaluate whether the AI response correctly follows business booking and cancellation policies.\nScore 1.0 if fully compliant, 0.0 if it contradicts a policy.',
      model: 'openai/gpt-5.4-mini',
      enabled: true,
    },
    {
      id: 'scorer-tone',
      name: 'Professional Tone',
      description:
        'Rates whether response maintains professional, helpful tone',
      criteria:
        'Evaluate tone and professionalism.\nScore 1.0 for perfect tone, 0.5 for acceptable, 0.0 for inappropriate.',
      model: 'openai/gpt-5.4-mini',
      enabled: true,
    },
    {
      id: 'scorer-accuracy',
      name: 'Availability Accuracy',
      description:
        'Checks if agent accurately reports appointment availability',
      criteria:
        'Evaluate availability handling accuracy.\nScore 1.0 if correct, 0.0 if it made up availability.',
      model: 'openai/gpt-5.4-mini',
      enabled: true,
    },
  ];

  await db.insert(aiScorers).values(seedScorers).onConflictDoNothing();
  console.log(`${green('✓')} Seeded ${seedScorers.length} custom scorers`);

  // ─── Labels ──────────────────────────────────────────────────────
  const seedLabels = [
    {
      id: 'lbl-vip',
      title: 'VIP',
      color: '#8b5cf6',
      description: 'High-value customers',
    },
    {
      id: 'lbl-bug',
      title: 'Bug',
      color: '#ef4444',
      description: 'Bug reports from customers',
    },
    {
      id: 'lbl-feedback',
      title: 'Feedback',
      color: '#22c55e',
      description: 'Customer feedback',
    },
    {
      id: 'lbl-urgent',
      title: 'Urgent',
      color: '#f97316',
      description: 'Requires immediate attention',
    },
    {
      id: 'lbl-followup',
      title: 'Follow-up',
      color: '#3b82f6',
      description: 'Needs follow-up action',
    },
  ];

  await db.insert(labels).values(seedLabels).onConflictDoNothing();

  const labelAssignments = [
    // VIP labels on Charlie and Alice
    { interactionId: 'int-charlie-wa-01', labelId: 'lbl-vip' },
    { interactionId: 'int-alice-wa-10', labelId: 'lbl-vip' },
    // Urgent on Jenny and Lily
    { interactionId: 'int-jenny-wa-1', labelId: 'lbl-urgent' },
    { interactionId: 'int-lily-wa-1', labelId: 'lbl-urgent' },
    // Follow-up on Diana (abandoned)
    { interactionId: 'int-diana-wa-1', labelId: 'lbl-followup' },
    // Feedback on Bob
    { interactionId: 'int-bob-web-06', labelId: 'lbl-feedback' },
    // Bug on Fiona (failed)
    { interactionId: 'int-fiona-web-1', labelId: 'lbl-bug' },
    // Multi-label: Alice's reopened interaction gets VIP + follow-up
    { interactionId: 'int-alice-wa-10', labelId: 'lbl-followup' },
    // Bulk interactions get some labels too
    ...bulkInteractions.slice(0, 8).map((int, i) => ({
      interactionId: int.id,
      labelId: seedLabels[i % seedLabels.length].id,
    })),
  ];

  await db
    .insert(interactionLabels)
    .values(labelAssignments)
    .onConflictDoNothing();

  // Migrate interactionLabels → contactLabels (dedup by contact+label)
  const interactionContactMap = new Map<string, string>();
  for (const int of allInteractions) {
    interactionContactMap.set(int.id, int.contactId);
  }
  const contactLabelSet = new Set<string>();
  const contactLabelRows: { contactId: string; labelId: string }[] = [];
  for (const la of labelAssignments) {
    const cId = interactionContactMap.get(la.interactionId);
    if (!cId) continue;
    const key = `${cId}:${la.labelId}`;
    if (contactLabelSet.has(key)) continue;
    contactLabelSet.add(key);
    contactLabelRows.push({ contactId: cId, labelId: la.labelId });
  }
  if (contactLabelRows.length > 0) {
    await db
      .insert(contactLabels)
      .values(contactLabelRows)
      .onConflictDoNothing();
  }
  console.log(
    `${green('✓')} Seeded ${seedLabels.length} labels, ${labelAssignments.length} interaction assignments, ${contactLabelRows.length} contact labels`,
  );

  // ─── Summary ─────────────────────────────────────────────────────
  console.log(
    `\n${green('Done!')} Seeded ${allInteractions.length} interactions, ${allMessages.length + seedActivityMessages.length} messages, ${seedConsultations.length} consultations, ${seedParticipants.length} participants`,
  );
}
