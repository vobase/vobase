/**
 * Seed: messaging + agents modules — realistic demo data for a booking service.
 *
 * Covers every lifecycle state and new model feature:
 * - ~20 named contacts (customers, leads, staff) with intentional relationships
 * - 3 channel instances (WhatsApp, Web, Email) + 3 routings
 * - ~90 conversations across all statuses, assignees, outcomes, and autonomy levels
 * - Multi-conversation contacts for timeline testing
 * - Reopened conversations (reopenCount > 0)
 * - Conversation participants (multi-participant / CC / BCC)
 * - Channel instance → team mappings
 * - ~3 messages per conversation
 * - Labels, reactions, feedback, channel sessions, activity events
 */

import { faker } from '@faker-js/faker';
import type { VobaseDb } from '@vobase/core';
import {
  authMember,
  authOrganization,
  authUser,
  channelsTemplates,
} from '@vobase/core';
import { eq } from 'drizzle-orm';

import {
  automationRuleSteps,
  automationRules,
  broadcastRecipients,
  broadcasts,
  channelInstances,
  channelInstanceTeams,
  channelRoutings,
  channelSessions,
  contactAttributeDefinitions,
  contactLabels,
  contacts,
  conversationLabels,
  conversationParticipants,
  conversations,
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
// Each key is a conversation ID. Turns are [customer, agent] pairs that
// read as a continuous story when viewing the contact's timeline.

const SCRIPTED: Record<string, Array<[string, string]>> = {
  // ── Alice: WhatsApp — all 10 original segments concatenated under the surviving conversation ID
  // Continuous journey: new patient → booking → post-visit → billing issue → referral → loyalty
  'int-alice-wa-10': [
    // segment 1 — first appointment inquiry
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
    // segment 2 — pre-visit questions
    [
      'Hi, quick question before my appointment tomorrow — do I need to fast?',
      'Hi Alice! For a general consultation, no fasting is required. Just bring your ID and any current medications list.',
    ],
    [
      'Great, and where exactly is the clinic? I have not been before.',
      'We are at Block 5, #03-12, Orchard Medical Centre. Basement parking available — first 2 hours free. See you tomorrow at 2 PM!',
    ],
    // segment 3 — post-visit feedback → billing question
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
    // segment 4 — insurance billing question
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
    // segment 5 — reschedule follow-up
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
    // segment 6 — parking question
    [
      'Quick question — is there parking validation for the Tuesday visit too?',
      'Yes, Alice! Same as before — basement parking at Block 5, first 2 hours free. Just validate at reception.',
    ],
    ['Perfect, thanks!', 'You are welcome! See you Tuesday.'],
    // segment 7 — specialist referral
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
    // segment 8 — specialist appointment confirmation
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
    // segment 9 — confirm specialist visit → asked about family plan
    [
      'Specialist visit went well! Dr. Lee said everything looks normal. Huge relief.',
      'That is wonderful news, Alice! So glad to hear it.',
    ],
    [
      'Thanks for all the help over the past couple weeks. Actually — do you offer family health plans? My husband might need a checkup too.',
      'We do! Since this is a new topic, let me wrap up the specialist follow-up and start a fresh inquiry about family plans.',
    ],
    // segment 10 — family wellness package inquiry (current active segment)
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
  // ── Bob email (surviving int-bob-email-02): 2 segments concatenated
  'int-bob-email-02': [
    // segment 1 — email confirmation with CC to assistant
    [
      'Hi, this is Bob Wong. Following up on my multi-branch booking from web chat. Cc-ing my assistant Alice.',
      'Hi Bob! Your bookings are confirmed: Orchard Monday 10 AM, Tampines Monday 2 PM. References: BK-5102 and BK-5103.',
    ],
    [
      'Can you send details to this thread so my assistant has them?',
      'Done! Full confirmation sent. Both appointments locked in.',
    ],
    // segment 2 — refund confirmation follow-up
    [
      'Subject: Refund Confirmation\n\nDid the duplicate charge refund go through? I do not see it yet.',
      'Hi Bob! I checked — the refund was processed yesterday and should appear in your account within 1-2 business days. Reference: REF-3301.',
    ],
    [
      'Ok, I will check tomorrow. Thanks.',
      'You are welcome! Let us know if it does not show up by Friday.',
    ],
  ],
  // ── Bob web (surviving int-bob-web-06): all 6 original segments concatenated
  'int-bob-web-06': [
    // segment 1 — multi-location booking
    [
      'I need to book consultations at two locations — Orchard and Tampines. Back-to-back if possible.',
      'Hi Bob! Multi-branch bookings need manual coordination. Let me check both locations for you.',
    ],
    [
      'The sooner the better. Ideally next week.',
      'I have flagged this for our scheduling team. David will coordinate the dual booking and reach out shortly.',
    ],
    // segment 2 — rescheduling
    [
      'My Monday schedule changed. Can we move Orchard to Tuesday?',
      'Hi Bob! Checking Tuesday... 10:00 AM is available at Orchard. Tampines stays Monday 2 PM. Update both?',
    ],
    [
      'Yes please. Sorry for the changes.',
      'No problem! Updated: Orchard → Tuesday 10 AM (BK-5104), Tampines → Monday 2 PM (BK-5105).',
    ],
    // segment 3 — billing discrepancy
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
    // segment 4 — pre-visit checklist
    [
      'What should I bring to the Tampines appointment?',
      'Hi Bob! For Tampines, bring your ID and the referral note from your Orchard visit (if applicable). Also bring your medication list.',
    ],
    ['Got it, thanks.', 'You are all set! See you Monday at 2 PM at Tampines.'],
    // segment 5 — post-visit feedback → new booking
    [
      'Both appointments done. Orchard was great, Tampines was a bit rushed.',
      'Thanks for the feedback, Bob! I will pass the Tampines note to our quality team. Anything else you need?',
    ],
    [
      'Actually yes — I want to book the next quarterly checkup. Different topic though.',
      'Got it! Let me close out the feedback and start fresh on the quarterly booking.',
    ],
    // segment 6 — quarterly checkup booking (current active segment)
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

  // ── Charlie (surviving int-charlie-wa-06): all 6 original segments concatenated
  'int-charlie-wa-06': [
    // segment 1 — monthly checkup booking
    [
      'This is Charlie Lee. Monthly checkup please.',
      "Good morning, Mr. Lee! Checking Dr. Tan's availability for your monthly slot.",
    ],
    [
      'Thursday as usual. Private room.',
      'Thursday 2 PM, private room confirmed. David will handle your booking personally as always.',
    ],
    // segment 2 — time change request
    [
      'David, can we change Thursday to 3 PM? My meeting ran over.',
      'Hi Mr. Lee! David has shifted your appointment to 3 PM. Same private room.',
    ],
    [
      'Good. Also, I need the extended 90-minute session this time.',
      'Noted — 90-minute session with Dr. Tan at 3 PM. Updated.',
    ],
    // segment 3 — results discussion
    [
      'Checkup went well. Dr. Tan wants to discuss the cholesterol numbers. When can I call in?',
      'Glad to hear it went well! For the results discussion, Dr. Tan has a call slot at 11 AM tomorrow. Shall I book that?',
    ],
    [
      'Yes. Actually, better have David arrange it. I need my full records pulled.',
      'Understood. David will pull your records and set up the call with Dr. Tan for 11 AM tomorrow.',
    ],
    // segment 4 — prescription refill
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
    // segment 5 — 90-minute session booking
    [
      'Need to see Dr. Tan again. 90-minute session, private room. Next Thursday.',
      'Hi Mr. Lee! Next Thursday is available. David will confirm the 90-minute private room session.',
    ],
    [
      'Tell David to also book the lab for a full panel before the appointment.',
      'Noted — full blood panel + 90-minute consultation. David is arranging both.',
    ],
    // segment 6 — urgent test results follow-up (current active segment)
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

// Generic dialogue turns used only for bulk (random) conversations
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
// Fixed IDs so conversations can reference them deterministically.

const SEED_CONTACTS = [
  // Staff (3)
  {
    id: 'c-staff-david',
    phone: '+6590001111',
    email: 'david@clinic.sg',
    name: 'David Lim',
    role: 'staff' as const,
    attributes: { department: 'operations' },
  },
  {
    id: 'c-staff-eve',
    phone: '+6590002222',
    email: 'eve@clinic.sg',
    name: 'Eve Chen',
    role: 'staff' as const,
    attributes: { department: 'management' },
  },
  {
    id: 'c-staff-frank',
    phone: '+6590003333',
    email: 'frank@clinic.sg',
    name: 'Frank Ng',
    role: 'staff' as const,
    attributes: { department: 'clinical' },
  },
  // Customers (12) — intentionally named so we can create multi-conversation timelines
  {
    id: 'c-alice',
    phone: '+6581110001',
    email: 'alice@example.com',
    name: 'Alice Tan',
    role: 'customer' as const,
    attributes: { source: 'whatsapp' },
  },
  {
    id: 'c-bob',
    phone: '+6581110002',
    email: 'bob@example.com',
    name: 'Bob Wong',
    role: 'customer' as const,
    attributes: { source: 'web' },
  },
  {
    id: 'c-charlie',
    phone: '+6581110003',
    email: 'charlie@example.com',
    name: 'Charlie Lee',
    role: 'customer' as const,
    attributes: { source: 'referral' },
  },
  {
    id: 'c-diana',
    phone: '+6581110004',
    email: 'diana@example.com',
    name: 'Diana Goh',
    role: 'customer' as const,
    attributes: { source: 'whatsapp' },
  },
  {
    id: 'c-edward',
    phone: '+6581110005',
    email: 'edward@example.com',
    name: 'Edward Lim',
    role: 'customer' as const,
    attributes: { source: 'web' },
  },
  {
    id: 'c-fiona',
    phone: '+6581110006',
    email: 'fiona@example.com',
    name: 'Fiona Yap',
    role: 'customer' as const,
    attributes: { source: 'walk-in' },
  },
  {
    id: 'c-george',
    phone: '+6581110007',
    email: 'george@example.com',
    name: 'George Ong',
    role: 'customer' as const,
    attributes: { source: 'whatsapp' },
  },
  {
    id: 'c-hannah',
    phone: '+6581110008',
    email: 'hannah@example.com',
    name: 'Hannah Koh',
    role: 'customer' as const,
    attributes: { source: 'web' },
  },
  {
    id: 'c-ivan',
    phone: '+6581110009',
    email: 'ivan@example.com',
    name: 'Ivan Chua',
    role: 'customer' as const,
    attributes: { source: 'referral' },
  },
  {
    id: 'c-jenny',
    phone: '+6581110010',
    email: 'jenny@example.com',
    name: 'Jenny Sim',
    role: 'customer' as const,
    attributes: { source: 'whatsapp' },
  },
  {
    id: 'c-kenny',
    phone: '+6581110011',
    email: 'kenny@example.com',
    name: 'Kenny Ng',
    role: 'customer' as const,
    attributes: { source: 'web' },
  },
  {
    id: 'c-lily',
    phone: '+6581110012',
    email: 'lily@example.com',
    name: 'Lily Ho',
    role: 'customer' as const,
    attributes: { source: 'walk-in' },
  },
  // Leads (5)
  {
    id: 'c-lead-mark',
    phone: '+6581120001',
    email: 'mark@example.com',
    name: 'Mark Teo',
    role: 'lead' as const,
    attributes: {
      source: 'google-ads',
      campaign: 'q2-booking',
      segment: 'lunch_crowd',
    },
  },
  {
    id: 'c-lead-nina',
    phone: '+6581120002',
    email: 'nina@example.com',
    name: 'Nina Loh',
    role: 'lead' as const,
    attributes: {
      source: 'facebook',
      campaign: 'wellness',
      segment: 'happy_hour_crowd',
    },
  },
  {
    id: 'c-lead-oscar',
    phone: '+6581120003',
    email: 'oscar@example.com',
    name: 'Oscar Pang',
    role: 'lead' as const,
    attributes: {
      source: 'instagram',
      campaign: 'promo',
      segment: 'lunch_crowd',
    },
  },
  {
    id: 'c-lead-paula',
    phone: '+6581120004',
    email: 'paula@example.com',
    name: 'Paula Quek',
    role: 'lead' as const,
    attributes: {
      source: 'organic',
      segment: 'high_roller',
      lifetime_spend_cents: '185400',
    },
  },
  {
    id: 'c-lead-ray',
    phone: '+6581120005',
    email: 'ray@example.com',
    name: 'Ray Soh',
    role: 'lead' as const,
    attributes: {
      source: 'referral',
      segment: 'high_roller',
      lifetime_spend_cents: '124900',
    },
  },
];

const customers = SEED_CONTACTS.filter((c) => c.role === 'customer');

// ─── Contact attribute definitions ──────────────────────────────────

const SEED_ATTRIBUTE_DEFINITIONS = [
  {
    key: 'company',
    label: 'Company',
    type: 'text',
    showInTable: true,
    sortOrder: 0,
  },
  {
    key: 'source',
    label: 'Acquisition Source',
    type: 'text',
    showInTable: true,
    sortOrder: 1,
  },
  {
    key: 'notes',
    label: 'Internal Notes',
    type: 'text',
    showInTable: false,
    sortOrder: 2,
  },
  {
    key: 'insurance_plan',
    label: 'Insurance Plan',
    type: 'text',
    showInTable: true,
    sortOrder: 3,
  },
  {
    key: 'date_of_birth',
    label: 'Date of Birth',
    type: 'date',
    showInTable: false,
    sortOrder: 4,
  },
  {
    key: 'visit_count',
    label: 'Total Visits',
    type: 'number',
    showInTable: true,
    sortOrder: 5,
  },
  {
    key: 'preferred_doctor',
    label: 'Preferred Doctor',
    type: 'text',
    showInTable: false,
    sortOrder: 6,
  },
  {
    key: 'is_corporate',
    label: 'Corporate Account',
    type: 'boolean',
    showInTable: true,
    sortOrder: 7,
  },
  {
    key: 'segment',
    label: 'Marketing Segment',
    type: 'text',
    showInTable: true,
    sortOrder: 8,
  },
  {
    key: 'lifetime_spend_cents',
    label: 'Lifetime Spend (cents)',
    type: 'number',
    showInTable: false,
    sortOrder: 9,
  },
];

// ─── WhatsApp message templates ─────────────────────────────────────

const SEED_TEMPLATES = [
  {
    id: 'tmpl-appt-reminder',
    channel: 'whatsapp',
    externalId: 'wa-tmpl-1001',
    name: 'appointment_reminder',
    language: 'en',
    category: 'UTILITY',
    status: 'APPROVED',
    components: JSON.stringify([
      { type: 'HEADER', format: 'TEXT', text: 'Appointment Reminder' },
      {
        type: 'BODY',
        text: 'Hi {{1}}, this is a reminder that you have an appointment at {{2}} on {{3}}. Please arrive 10 minutes early and bring your ID. Reference: {{4}}.',
      },
      { type: 'FOOTER', text: 'Orchard Medical Centre' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Confirm' },
          { type: 'QUICK_REPLY', text: 'Reschedule' },
          { type: 'QUICK_REPLY', text: 'STOP' },
        ],
      },
    ]),
    syncedAt: hoursAgo(72),
  },
  {
    id: 'tmpl-appt-confirm',
    channel: 'whatsapp',
    externalId: 'wa-tmpl-1002',
    name: 'appointment_confirmation',
    language: 'en',
    category: 'UTILITY',
    status: 'APPROVED',
    components: JSON.stringify([
      { type: 'HEADER', format: 'TEXT', text: 'Booking Confirmed ✓' },
      {
        type: 'BODY',
        text: 'Hi {{1}}, your appointment is confirmed!\n\n📅 Date: {{2}}\n🕐 Time: {{3}}\n📍 Location: {{4}}\n🔖 Reference: {{5}}\n\nBring your ID and any current medications list.',
      },
      { type: 'FOOTER', text: 'Orchard Medical Centre' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Add to Calendar' },
          { type: 'QUICK_REPLY', text: 'Cancel Booking' },
        ],
      },
    ]),
    syncedAt: hoursAgo(72),
  },
  {
    id: 'tmpl-appt-reschedule',
    channel: 'whatsapp',
    externalId: 'wa-tmpl-1006',
    name: 'appointment_rescheduled',
    language: 'en',
    category: 'UTILITY',
    status: 'APPROVED',
    components: JSON.stringify([
      { type: 'HEADER', format: 'TEXT', text: 'Appointment Rescheduled' },
      {
        type: 'BODY',
        text: 'Hi {{1}}, your appointment has been rescheduled.\n\n❌ Original: {{2}}\n✅ New date: {{3}} at {{4}}\n📍 {{5}}\n\nIf this does not work, reply and we will find another time.',
      },
      { type: 'FOOTER', text: 'Orchard Medical Centre' },
    ]),
    syncedAt: hoursAgo(96),
  },
  {
    id: 'tmpl-lab-results',
    channel: 'whatsapp',
    externalId: 'wa-tmpl-1003',
    name: 'lab_results_ready',
    language: 'en',
    category: 'UTILITY',
    status: 'APPROVED',
    components: JSON.stringify([
      { type: 'HEADER', format: 'TEXT', text: 'Your Lab Results Are Ready' },
      {
        type: 'BODY',
        text: 'Hi {{1}}, your lab results from {{2}} are now available. Dr. {{3}} has reviewed them and would like to discuss the findings. Please book a follow-up at your earliest convenience.',
      },
      { type: 'FOOTER', text: 'Results are strictly confidential' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Book Follow-up' },
          { type: 'QUICK_REPLY', text: 'STOP' },
        ],
      },
    ]),
    syncedAt: hoursAgo(48),
  },
  {
    id: 'tmpl-screening-promo',
    channel: 'whatsapp',
    externalId: 'wa-tmpl-1004',
    name: 'health_screening_promo',
    language: 'en',
    category: 'MARKETING',
    status: 'APPROVED',
    components: JSON.stringify([
      { type: 'HEADER', format: 'TEXT', text: '🏥 Annual Health Screening' },
      {
        type: 'BODY',
        text: "Hi {{1}}, it's time for your annual checkup! Book your Comprehensive Health Screening this {{2}} and get {{3}} off.\n\nIncludes blood panel, BMI, blood pressure, and cholesterol screening.\n\nOffer valid until {{4}}.",
      },
      { type: 'FOOTER', text: 'Orchard Medical Centre' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Book Now' },
          { type: 'QUICK_REPLY', text: 'Learn More' },
          { type: 'QUICK_REPLY', text: 'STOP' },
        ],
      },
    ]),
    syncedAt: hoursAgo(120),
  },
  {
    id: 'tmpl-new-patient',
    channel: 'whatsapp',
    externalId: 'wa-tmpl-1005',
    name: 'new_patient_welcome',
    language: 'en',
    category: 'MARKETING',
    status: 'APPROVED',
    components: JSON.stringify([
      {
        type: 'HEADER',
        format: 'TEXT',
        text: 'Welcome to Orchard Medical Centre',
      },
      {
        type: 'BODY',
        text: 'Hi {{1}}, welcome! As a new patient, enjoy 20% off your first consultation.\n\n🩺 General Consultations\n🔬 Health Screenings\n💊 Pharmacy\n👁️ Specialist Referrals\n\nUse code NEW20 when booking. Valid for 30 days.',
      },
      { type: 'FOOTER', text: 'Orchard Medical Centre · Block 5, #03-12' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Book Consultation' },
          { type: 'QUICK_REPLY', text: 'STOP' },
        ],
      },
    ]),
    syncedAt: hoursAgo(240),
  },
  {
    id: 'tmpl-corporate-wellness',
    channel: 'whatsapp',
    externalId: null,
    name: 'corporate_wellness_package',
    language: 'en',
    category: 'MARKETING',
    status: 'DRAFT',
    components: JSON.stringify([
      { type: 'HEADER', format: 'TEXT', text: 'Corporate Wellness Programme' },
      {
        type: 'BODY',
        text: 'Hi {{1}}, we have a tailored wellness programme for {{2}} and your team.\n\n✅ Annual screenings for up to {{3}} employees\n✅ 15% group discount\n✅ Flexible scheduling across all branches\n✅ Digital health report per employee\n\nReply to schedule a call with our corporate team.',
      },
      { type: 'FOOTER', text: 'Orchard Medical Centre · Enterprise Solutions' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Get a Quote' },
          { type: 'QUICK_REPLY', text: 'STOP' },
        ],
      },
    ]),
    syncedAt: hoursAgo(24),
  },
  {
    id: 'tmpl-post-visit-survey',
    channel: 'whatsapp',
    externalId: null,
    name: 'post_visit_survey',
    language: 'en',
    category: 'MARKETING',
    status: 'PENDING',
    components: JSON.stringify([
      { type: 'HEADER', format: 'TEXT', text: 'How Was Your Visit?' },
      {
        type: 'BODY',
        text: 'Hi {{1}}, thank you for visiting us on {{2}}. Your feedback helps us improve. How would you rate your experience with Dr. {{3}} today?',
      },
      { type: 'FOOTER', text: 'Your response is anonymous' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: '😊 Great' },
          { type: 'QUICK_REPLY', text: '😐 Okay' },
          { type: 'QUICK_REPLY', text: '😞 Poor' },
        ],
      },
    ]),
    syncedAt: hoursAgo(12),
  },
  {
    id: 'tmpl-lunch-crowd-promo',
    channel: 'whatsapp',
    externalId: 'wa-tmpl-1007',
    name: 'weekday_lunch_promo',
    language: 'en',
    category: 'MARKETING',
    status: 'APPROVED',
    components: JSON.stringify([
      { type: 'HEADER', format: 'TEXT', text: '🍜 Weekday Lunch Special' },
      {
        type: 'BODY',
        text: 'Hi {{1}}, the 2-course weekday lunch set ({{2}}) is back this week. Mon–Fri, 12:00–2:00 PM. Reserve ahead to skip the queue.',
      },
      { type: 'FOOTER', text: 'OrchardHealth · Appointment Reminder' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Book Now' },
          { type: 'QUICK_REPLY', text: 'See Menu' },
          { type: 'QUICK_REPLY', text: 'STOP' },
        ],
      },
    ]),
    syncedAt: hoursAgo(48),
  },
  {
    id: 'tmpl-happy-hour-promo',
    channel: 'whatsapp',
    externalId: 'wa-tmpl-1008',
    name: 'happy_hour_promo',
    language: 'en',
    category: 'MARKETING',
    status: 'APPROVED',
    components: JSON.stringify([
      { type: 'HEADER', format: 'TEXT', text: '🎉 Happy Hour Reminder' },
      {
        type: 'BODY',
        text: 'Hi {{1}}, join us for Happy Hour — Mon–Fri, 4:00–8:00 PM. {{2}} on selected items.',
      },
      { type: 'FOOTER', text: 'OrchardHealth · Wellness Promotions' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Reserve a Slot' },
          { type: 'QUICK_REPLY', text: 'STOP' },
        ],
      },
    ]),
    syncedAt: hoursAgo(48),
  },
  {
    id: 'tmpl-high-roller-invite',
    channel: 'whatsapp',
    externalId: 'wa-tmpl-1009',
    name: 'vip_invite',
    language: 'en',
    category: 'MARKETING',
    status: 'APPROVED',
    components: JSON.stringify([
      {
        type: 'HEADER',
        format: 'TEXT',
        text: '✨ A private invitation for you',
      },
      {
        type: 'BODY',
        text: "Hi {{1}}, as one of our most valued clients we'd like to invite you to our exclusive event on {{2}}. Limited spots available.",
      },
      { type: 'FOOTER', text: 'RSVP required · By invitation only' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Reserve My Spot' },
          { type: 'QUICK_REPLY', text: 'Not this time' },
        ],
      },
    ]),
    syncedAt: hoursAgo(48),
  },
];

// ─── Broadcasts ──────────────────────────────────────────────────────

const SEED_BROADCASTS = [
  // Completed: Q1 health screening campaign (sent 30 days ago)
  {
    id: 'bc-q1-screening',
    name: 'Q1 Health Screening Campaign',
    channelInstanceId: 'ci-wa-main',
    templateId: 'tmpl-screening-promo',
    templateName: 'health_screening_promo',
    templateLanguage: 'en',
    variableMapping: {
      '1': 'name',
      '2': 'March',
      '3': '20%',
      '4': '31 March 2026',
    },
    status: 'completed',
    totalRecipients: 17,
    sentCount: 16,
    deliveredCount: 14,
    readCount: 10,
    failedCount: 1,
    startedAt: hoursAgo(720),
    completedAt: hoursAgo(719),
    createdBy: 'seed-admin',
  },
  // Completed: New patient welcome (sent 2 months ago)
  {
    id: 'bc-new-patient-feb',
    name: 'New Patient Welcome — February Leads',
    channelInstanceId: 'ci-wa-main',
    templateId: 'tmpl-new-patient',
    templateName: 'new_patient_welcome',
    templateLanguage: 'en',
    variableMapping: { '1': 'name' },
    status: 'completed',
    totalRecipients: 5,
    sentCount: 5,
    deliveredCount: 5,
    readCount: 3,
    failedCount: 0,
    startedAt: hoursAgo(1440),
    completedAt: hoursAgo(1439),
    createdBy: 'seed-admin',
  },
  // Scheduled: Q2 screening (launches in 2 days)
  {
    id: 'bc-q2-screening',
    name: 'Q2 Health Screening Campaign',
    channelInstanceId: 'ci-wa-main',
    templateId: 'tmpl-screening-promo',
    templateName: 'health_screening_promo',
    templateLanguage: 'en',
    variableMapping: {
      '1': 'name',
      '2': 'April',
      '3': '25%',
      '4': '30 April 2026',
    },
    status: 'scheduled',
    scheduledAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    timezone: 'Asia/Singapore',
    totalRecipients: 14,
    sentCount: 0,
    deliveredCount: 0,
    readCount: 0,
    failedCount: 0,
    createdBy: 'seed-admin',
  },
  // Paused: lab results batch (mid-send)
  {
    id: 'bc-lab-results-apr',
    name: 'Lab Results Notification — April Batch',
    channelInstanceId: 'ci-wa-main',
    templateId: 'tmpl-lab-results',
    templateName: 'lab_results_ready',
    templateLanguage: 'en',
    variableMapping: { '1': 'name', '2': 'date', '3': 'Dr. Tan' },
    status: 'paused',
    totalRecipients: 8,
    sentCount: 3,
    deliveredCount: 3,
    readCount: 2,
    failedCount: 0,
    startedAt: hoursAgo(6),
    createdBy: 'seed-admin',
  },
  // Failed: appointment reminders (API error mid-send)
  {
    id: 'bc-appt-reminders-mar',
    name: 'March Appointment Reminders',
    channelInstanceId: 'ci-wa-main',
    templateId: 'tmpl-appt-reminder',
    templateName: 'appointment_reminder',
    templateLanguage: 'en',
    variableMapping: {
      '1': 'name',
      '2': 'Orchard Medical Centre',
      '3': 'date',
      '4': 'reference',
    },
    status: 'failed',
    totalRecipients: 12,
    sentCount: 4,
    deliveredCount: 3,
    readCount: 1,
    failedCount: 8,
    startedAt: hoursAgo(360),
    createdBy: 'seed-admin',
  },
  // Draft: corporate wellness outreach (being configured)
  {
    id: 'bc-corp-wellness-apr',
    name: 'Corporate Wellness Outreach — April 2026',
    channelInstanceId: 'ci-wa-main',
    templateId: 'tmpl-corporate-wellness',
    templateName: 'corporate_wellness_package',
    templateLanguage: 'en',
    variableMapping: { '1': 'name', '2': 'company', '3': '20' },
    status: 'draft',
    totalRecipients: 0,
    sentCount: 0,
    deliveredCount: 0,
    readCount: 0,
    failedCount: 0,
    createdBy: 'seed-admin',
  },
];

// ─── Automation rules ────────────────────────────────────────────────
// Three segmented lead-nurture automations that fire on a recurring
// cron schedule. Audience is resolved by the `segment` attribute.

const SEED_AUTOMATION_RULES: (typeof automationRules.$inferInsert)[] = [
  {
    id: 'ar-lunch-crowd',
    name: 'Lunch Crowd — Weekly Promo',
    description:
      'Every Monday morning, nudge the lunch-crowd lead list to book into the Mon–Fri 12–2 PM seatings.',
    type: 'recurring' as const,
    isActive: true,
    audienceFilter: {
      roles: ['lead' as const],
      attributes: [{ key: 'segment', value: 'lunch_crowd', op: 'eq' as const }],
      excludeOptedOut: true,
    },
    channelInstanceId: 'ci-wa-main',
    schedule: '0 10 * * 1',
    timezone: 'Asia/Singapore',
    parameters: { setName: '2-course weekday set' },
    parameterSchema: {
      setName: { type: 'string', label: 'Set name' },
    },
    createdBy: 'seed-admin',
  },
  {
    id: 'ar-happy-hour-crowd',
    name: 'Happy Hour Crowd — Weekly Reminder',
    description:
      'Every Thursday afternoon, remind the happy-hour lead list about Mon–Fri 4–8 PM offers.',
    type: 'recurring' as const,
    isActive: true,
    audienceFilter: {
      roles: ['lead' as const],
      attributes: [
        { key: 'segment', value: 'happy_hour_crowd', op: 'eq' as const },
      ],
      excludeOptedOut: true,
    },
    channelInstanceId: 'ci-wa-main',
    schedule: '0 15 * * 4',
    timezone: 'Asia/Singapore',
    parameters: { discount: '1-for-1 wellness packages' },
    parameterSchema: {
      discount: { type: 'string' as const, label: 'Offer text' },
    },
    createdBy: 'seed-admin',
  },
  {
    id: 'ar-high-roller',
    name: 'VIP — Monthly Exclusive Invite',
    description:
      'First of each month, invite high-value leads to an exclusive event.',
    type: 'recurring' as const,
    isActive: true,
    audienceFilter: {
      roles: ['lead' as const],
      attributes: [
        { key: 'segment', value: 'high_roller', op: 'eq' as const },
        { key: 'lifetime_spend_cents', value: '100000', op: '>=' as const },
      ],
      excludeOptedOut: true,
    },
    channelInstanceId: 'ci-wa-main',
    schedule: '0 11 1 * *',
    timezone: 'Asia/Singapore',
    parameters: { eventDate: 'Saturday 9 May, 7:30 PM' },
    parameterSchema: {
      eventDate: { type: 'string' as const, label: 'Next event date' },
    },
    createdBy: 'seed-admin',
  },
];

const SEED_AUTOMATION_RULE_STEPS = [
  {
    ruleId: 'ar-lunch-crowd',
    sequence: 1,
    templateId: 'tmpl-lunch-crowd-promo',
    templateName: 'weekday_lunch_promo',
    templateLanguage: 'en',
    variableMapping: { '1': 'name', '2': 'parameters.setName' },
    isFinal: true,
  },
  {
    ruleId: 'ar-happy-hour-crowd',
    sequence: 1,
    templateId: 'tmpl-happy-hour-promo',
    templateName: 'happy_hour_promo',
    templateLanguage: 'en',
    variableMapping: { '1': 'name', '2': 'parameters.discount' },
    isFinal: true,
  },
  {
    ruleId: 'ar-high-roller',
    sequence: 1,
    templateId: 'tmpl-high-roller-invite',
    templateName: 'vip_invite',
    templateLanguage: 'en',
    variableMapping: { '1': 'name', '2': 'parameters.eventDate' },
    isFinal: true,
  },
];

// ─── Broadcast recipients ────────────────────────────────────────────
// Only for broadcasts that have been run or are in progress.

type BroadcastRecipientSeed = {
  id: string;
  broadcastId: string;
  contactId: string;
  phone: string;
  variables: Record<string, string>;
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped';
  failureReason?: string;
  sentAt?: Date;
  deliveredAt?: Date;
  readAt?: Date;
};

function buildRecipients(): BroadcastRecipientSeed[] {
  const rows: BroadcastRecipientSeed[] = [];

  // ── Q1 screening (completed) ─────────────────────────────────────
  const q1Cases: Array<[string, string, BroadcastRecipientSeed['status']]> = [
    ['c-alice', '+6581110001', 'read'],
    ['c-bob', '+6581110002', 'read'],
    ['c-charlie', '+6581110003', 'read'],
    ['c-diana', '+6581110004', 'delivered'],
    ['c-edward', '+6581110005', 'read'],
    ['c-fiona', '+6581110006', 'delivered'],
    ['c-george', '+6581110007', 'read'],
    ['c-hannah', '+6581110008', 'delivered'],
    ['c-ivan', '+6581110009', 'read'],
    ['c-jenny', '+6581110010', 'read'],
    ['c-kenny', '+6581110011', 'delivered'],
    ['c-lily', '+6581110012', 'read'],
    ['c-lead-mark', '+6581120001', 'failed'],
    ['c-lead-nina', '+6581120002', 'read'],
    ['c-lead-oscar', '+6581120003', 'read'],
    ['c-lead-paula', '+6581120004', 'delivered'],
    ['c-lead-ray', '+6581120005', 'delivered'],
  ];
  for (const [contactId, phone, status] of q1Cases) {
    const sentAt = status !== 'failed' ? hoursAgo(718) : undefined;
    const deliveredAt =
      status === 'delivered' || status === 'read' ? hoursAgo(717) : undefined;
    const readAt = status === 'read' ? hoursAgo(715) : undefined;
    rows.push({
      id: `br-q1-${contactId}`,
      broadcastId: 'bc-q1-screening',
      contactId,
      phone,
      variables: { '1': contactId.replace('c-', '').replace('lead-', '') },
      status,
      ...(status === 'failed' && {
        failureReason:
          'WhatsApp Cloud API error 131026: recipient not on WhatsApp',
      }),
      ...(sentAt && { sentAt }),
      ...(deliveredAt && { deliveredAt }),
      ...(readAt && { readAt }),
    });
  }

  // ── New patient welcome (completed) ──────────────────────────────
  const welcomeCases: Array<
    [string, string, BroadcastRecipientSeed['status']]
  > = [
    ['c-lead-mark', '+6581120001', 'read'],
    ['c-lead-nina', '+6581120002', 'read'],
    ['c-lead-oscar', '+6581120003', 'read'],
    ['c-lead-paula', '+6581120004', 'delivered'],
    ['c-lead-ray', '+6581120005', 'delivered'],
  ];
  for (const [contactId, phone, status] of welcomeCases) {
    const sentAt = hoursAgo(1439);
    const deliveredAt =
      status === 'delivered' || status === 'read' ? hoursAgo(1438) : undefined;
    const readAt = status === 'read' ? hoursAgo(1436) : undefined;
    rows.push({
      id: `br-welcome-${contactId}`,
      broadcastId: 'bc-new-patient-feb',
      contactId,
      phone,
      variables: { '1': contactId.replace('c-lead-', '') },
      status,
      sentAt,
      ...(deliveredAt && { deliveredAt }),
      ...(readAt && { readAt }),
    });
  }

  // ── Q2 screening (scheduled — queued recipients) ──────────────────
  const q2Contacts: Array<[string, string]> = [
    ['c-alice', '+6581110001'],
    ['c-bob', '+6581110002'],
    ['c-charlie', '+6581110003'],
    ['c-diana', '+6581110004'],
    ['c-edward', '+6581110005'],
    ['c-fiona', '+6581110006'],
    ['c-george', '+6581110007'],
    ['c-hannah', '+6581110008'],
    ['c-ivan', '+6581110009'],
    ['c-jenny', '+6581110010'],
    ['c-kenny', '+6581110011'],
    ['c-lily', '+6581110012'],
    ['c-lead-nina', '+6581120002'],
    ['c-lead-ray', '+6581120005'],
  ];
  for (const [contactId, phone] of q2Contacts) {
    rows.push({
      id: `br-q2-${contactId}`,
      broadcastId: 'bc-q2-screening',
      contactId,
      phone,
      variables: { '1': contactId.replace('c-', '').replace('lead-', '') },
      status: 'queued',
    });
  }

  // ── Lab results (paused mid-send) ────────────────────────────────
  const labCases: Array<[string, string, BroadcastRecipientSeed['status']]> = [
    ['c-alice', '+6581110001', 'read'],
    ['c-bob', '+6581110002', 'read'],
    ['c-charlie', '+6581110003', 'delivered'],
    ['c-diana', '+6581110004', 'queued'],
    ['c-edward', '+6581110005', 'queued'],
    ['c-fiona', '+6581110006', 'queued'],
    ['c-george', '+6581110007', 'queued'],
    ['c-hannah', '+6581110008', 'queued'],
  ];
  for (const [contactId, phone, status] of labCases) {
    const sentAt =
      status === 'read' || status === 'delivered' ? hoursAgo(5.5) : undefined;
    const deliveredAt =
      status === 'delivered' || status === 'read' ? hoursAgo(5) : undefined;
    const readAt = status === 'read' ? hoursAgo(4) : undefined;
    rows.push({
      id: `br-lab-${contactId}`,
      broadcastId: 'bc-lab-results-apr',
      contactId,
      phone,
      variables: {
        '1': contactId.replace('c-', ''),
        '2': '14 April 2026',
        '3': 'Tan',
      },
      status,
      ...(sentAt && { sentAt }),
      ...(deliveredAt && { deliveredAt }),
      ...(readAt && { readAt }),
    });
  }

  // ── March reminders (failed — API error at recipient 5) ───────────
  const marCases: Array<[string, string, BroadcastRecipientSeed['status']]> = [
    ['c-alice', '+6581110001', 'delivered'],
    ['c-bob', '+6581110002', 'read'],
    ['c-charlie', '+6581110003', 'delivered'],
    ['c-diana', '+6581110004', 'delivered'],
    ['c-edward', '+6581110005', 'failed'],
    ['c-fiona', '+6581110006', 'failed'],
    ['c-george', '+6581110007', 'failed'],
    ['c-hannah', '+6581110008', 'failed'],
    ['c-ivan', '+6581110009', 'failed'],
    ['c-jenny', '+6581110010', 'failed'],
    ['c-kenny', '+6581110011', 'failed'],
    ['c-lily', '+6581110012', 'failed'],
  ];
  for (const [contactId, phone, status] of marCases) {
    const wasSent = status === 'delivered' || status === 'read';
    rows.push({
      id: `br-mar-${contactId}`,
      broadcastId: 'bc-appt-reminders-mar',
      contactId,
      phone,
      variables: {
        '1': contactId.replace('c-', ''),
        '2': 'Orchard Medical Centre',
        '3': '15 March 2026',
        '4': 'BK-XXXX',
      },
      status,
      ...(wasSent && { sentAt: hoursAgo(359) }),
      ...(wasSent && { deliveredAt: hoursAgo(358) }),
      ...(status === 'read' && { readAt: hoursAgo(356) }),
      ...(status === 'failed' && {
        failureReason: 'WhatsApp Cloud API error 130429: rate limit exceeded',
      }),
    });
  }

  return rows;
}

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

// ─── Conversation templates ──────────────────────────────────────────
// Handcrafted conversations covering every dimension of the model.

type ConversationSeed = {
  id: string;
  channelRoutingId: string;
  contactId: string;
  agentId: string;
  channelInstanceId: string;
  status: string;
  startedAt: Date;
  resolvedAt?: Date;
  outcome?: string;
  autonomyLevel?: string;
  reopenCount?: number;
  assignee: string;
  assignedAt?: Date | null;
  onHold?: boolean;
  priority?: string;
  title?: string;
  metadata?: Record<string, unknown>;
};

const handcraftedConversations: ConversationSeed[] = [
  // ════════════════════════════════════════════════════════════════════
  // ALICE — Hero contact #1: WhatsApp conversation spanning 12 days
  // Single conversation (unique per contact+channel) with reopenCount=9
  // representing all 10 original conversation segments collapsed.
  // Shows a complete customer journey: new patient → regular → escalation → loyalty
  // ════════════════════════════════════════════════════════════════════
  {
    id: 'int-alice-wa-10',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-alice',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'active',
    startedAt: hoursAgo(288), // Day 1 — earliest segment start
    reopenCount: 9, // 10 segments → 9 reopens
    assignee: 'agent:booking',
    title: 'Family wellness package inquiry',
    metadata: {},
  },

  // ════════════════════════════════════════════════════════════════════
  // BOB — Hero contact #2: cross-channel conversations (Web + Email)
  // Web channel: single conversation with reopenCount=5 (6 segments collapsed)
  // Email channel: single conversation with reopenCount=1 (2 segments collapsed)
  // ════════════════════════════════════════════════════════════════════
  {
    id: 'int-bob-web-06',
    channelRoutingId: 'ep-web-booking',
    contactId: 'c-bob',
    agentId: 'booking',
    channelInstanceId: 'ci-web',
    status: 'active',
    startedAt: hoursAgo(240), // Day 1 — earliest web segment start
    reopenCount: 5, // 6 web segments → 5 reopens
    assignee: 'agent:booking',
    title: 'Multi-location booking request',
    metadata: {},
  },
  // Bob email: single conversation (2 segments collapsed, reopenCount=1)
  {
    id: 'int-bob-email-02',
    channelRoutingId: 'ep-email-support',
    contactId: 'c-bob',
    agentId: 'booking',
    channelInstanceId: 'ci-email',
    status: 'resolved',
    startedAt: hoursAgo(216), // Day 2 — earliest email segment start
    resolvedAt: hoursAgo(72),
    outcome: 'resolved',
    autonomyLevel: 'full_ai',
    reopenCount: 1, // 2 email segments → 1 reopen
    assignee: 'agent:booking',
    title: 'Email confirmation and refund follow-up',
    metadata: {},
  },

  // ════════════════════════════════════════════════════════════════════
  // CHARLIE — VIP patient: single WhatsApp conversation with reopenCount=5
  // (6 original segments collapsed — always handled by staff David)
  // ════════════════════════════════════════════════════════════════════
  {
    id: 'int-charlie-wa-06',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-charlie',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'active',
    startedAt: hoursAgo(192), // Day 1 — earliest segment start
    reopenCount: 5, // 6 segments → 5 reopens
    assignee: 'c-staff-david',
    priority: 'high',
    title: 'Urgent follow-up on test results',
    metadata: {},
  },

  // ════════════════════════════════════════════════════════════════════
  // Remaining contacts — 1-2 conversations each for variety
  // ════════════════════════════════════════════════════════════════════

  // Diana: abandoned (went silent)
  {
    id: 'int-diana-wa-1',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-diana',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'resolved',
    startedAt: hoursAgo(72),
    resolvedAt: hoursAgo(48),
    outcome: 'abandoned',
    autonomyLevel: 'full_ai',
    assignee: 'agent:booking',
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
    startedAt: hoursAgo(0.5),
    assignee: 'agent:booking',
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
    startedAt: hoursAgo(24),
    assignee: 'agent:booking',
    title: 'Family block booking — agent crashed',
    metadata: { error: 'Agent exceeded max steps' },
  },

  // George: topic change outcome
  {
    id: 'int-george-wa-1',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-george',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'resolved',
    startedAt: hoursAgo(3),
    resolvedAt: hoursAgo(0.5),
    outcome: 'topic_change',
    autonomyLevel: 'full_ai',
    assignee: 'agent:booking',
    title: 'Appointment confirmed → switching to physiotherapy inquiry',
    metadata: {},
  },

  // Hannah: human assignee with unread messages
  {
    id: 'int-hannah-web-1',
    channelRoutingId: 'ep-web-booking',
    contactId: 'c-hannah',
    agentId: 'booking',
    channelInstanceId: 'ci-web',
    status: 'active',
    startedAt: hoursAgo(2),
    assignee: 'c-staff-david',
    title: 'Refund request for no-show appointment',
    metadata: {},
  },

  // Ivan: active with pending approval
  {
    id: 'int-ivan-web-1',
    channelRoutingId: 'ep-web-booking',
    contactId: 'c-ivan',
    agentId: 'booking',
    channelInstanceId: 'ci-web',
    status: 'active',
    startedAt: hoursAgo(1),
    assignee: 'agent:booking',
    title: 'Corporate bulk booking — pending pricing approval',
    metadata: {},
  },

  // Jenny: on hold, urgent
  {
    id: 'int-jenny-wa-1',
    channelRoutingId: 'ep-wa-booking',
    contactId: 'c-jenny',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-main',
    status: 'active',
    startedAt: hoursAgo(3),
    assignee: 'agent:booking',
    onHold: true,
    priority: 'urgent',
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
    startedAt: hoursAgo(24),
    resolvedAt: hoursAgo(6),
    outcome: 'resolved',
    autonomyLevel: 'full_ai',
    assignee: 'agent:booking',
    title: 'Appointment confirmation email',
    metadata: {},
  },

  // Lily: 2 conversations (escalation story)
  {
    id: 'int-lily-web-1',
    channelRoutingId: 'ep-web-booking',
    contactId: 'c-lily',
    agentId: 'booking',
    channelInstanceId: 'ci-web',
    status: 'resolved',
    startedAt: hoursAgo(48),
    resolvedAt: hoursAgo(46),
    outcome: 'escalated',
    autonomyLevel: 'ai_with_escalation',
    assignee: 'agent:booking',
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
    startedAt: hoursAgo(0.5),
    assignee: 'c-staff-eve',
    priority: 'high',
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
    startedAt: hoursAgo(120),
    resolvedAt: hoursAgo(119),
    outcome: 'resolved',
    autonomyLevel: 'full_ai',
    assignee: 'agent:booking',
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
    startedAt: hoursAgo(4),
    assignee: 'agent:booking',
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
    startedAt: hoursAgo(200),
    resolvedAt: hoursAgo(198),
    outcome: 'abandoned',
    autonomyLevel: 'full_ai',
    assignee: 'agent:booking',
    title: 'Instagram promo inquiry — no follow-up',
    metadata: {},
  },
];

// ─── Bulk random conversations ───────────────────────────────────────
// Fill to ~90 total to populate lists and charts.

function generateBulkConversations(
  count: number,
  existingPairs: Set<string> = new Set(),
): ConversationSeed[] {
  const allCustomers = [
    ...customers,
    ...SEED_CONTACTS.filter((c) => c.role === 'lead'),
  ];
  const routings = SEED_CHANNEL_ROUTINGS.filter((r) => r.enabled);
  const items: ConversationSeed[] = [];

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
      startedAt,
      ...(resolvedAt && { resolvedAt }),
      ...(outcome && { outcome }),
      ...(autonomyLevel && { autonomyLevel }),
      reopenCount,
      assignee: 'agent:booking',
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

  // Deduplicate by (contactId, channelInstanceId) — exclude pairs that already
  // exist in handcrafted conversations and skip internal duplicates.
  // This satisfies the UNIQUE (contact_id, channel_instance_id) constraint.
  const seen = new Set<string>(existingPairs);
  return items.filter((item) => {
    const key = `${item.contactId}:${item.channelInstanceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Seed function ──────────────────────────────────────────────────

export default async function seed(ctx: { db: VobaseDb }) {
  const { db } = ctx;

  // ─── Contacts ────────────────────────────────────────────────────
  await db.insert(contacts).values(SEED_CONTACTS).onConflictDoNothing();
  console.log(`${green('✓')} Seeded ${SEED_CONTACTS.length} contacts`);

  // ─── Staff authUsers + org membership ────────────────────────────
  // Staff contacts are also auth users so they show up in the inbox
  // assignee dropdown, and are attached to the admin's org so they are
  // visible on /system/organizations. Platform provisioning can create a
  // second org (e.g. slug:local), so we pick the one admin actually owns
  // rather than "first row wins". Idempotent via email + member unique index.
  const staffContacts = SEED_CONTACTS.filter((c) => c.role === 'staff');
  const [defaultOrg] = await db
    .select({ id: authOrganization.id })
    .from(authMember)
    .innerJoin(
      authOrganization,
      eq(authMember.organizationId, authOrganization.id),
    )
    .innerJoin(authUser, eq(authMember.userId, authUser.id))
    .where(eq(authUser.email, 'admin@example.com'))
    .limit(1);

  for (const c of staffContacts) {
    await db
      .insert(authUser)
      .values({
        id: `u-${c.id}`,
        name: c.name,
        email: c.email,
        emailVerified: true,
        role: 'user',
      })
      .onConflictDoUpdate({
        target: authUser.email,
        set: { name: c.name, updatedAt: new Date() },
      });

    if (defaultOrg) {
      await db
        .insert(authMember)
        .values({
          id: `m-${c.id}`,
          userId: `u-${c.id}`,
          organizationId: defaultOrg.id,
          role: 'member',
        })
        .onConflictDoNothing();
    }
  }
  console.log(
    `${green('✓')} Seeded ${staffContacts.length} staff authUsers${
      defaultOrg ? ' + org members' : ' (no org found — skipped membership)'
    }`,
  );

  // ─── Contact Attribute Definitions ─────────────────────────────
  await db
    .insert(contactAttributeDefinitions)
    .values(SEED_ATTRIBUTE_DEFINITIONS)
    .onConflictDoNothing();
  console.log(
    `${green('✓')} Seeded ${SEED_ATTRIBUTE_DEFINITIONS.length} contact attribute definitions`,
  );

  // ─── WhatsApp Templates ──────────────────────────────────────────
  await db
    .insert(channelsTemplates)
    .values(SEED_TEMPLATES)
    .onConflictDoNothing();
  console.log(
    `${green('✓')} Seeded ${SEED_TEMPLATES.length} WhatsApp templates`,
  );

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

  // ─── Conversations ────────────────────────────────────────────────
  const handcraftedPairs = new Set(
    handcraftedConversations.map(
      (c) => `${c.contactId}:${c.channelInstanceId}`,
    ),
  );
  const bulkConversations = generateBulkConversations(65, handcraftedPairs);
  const allConversations = [...handcraftedConversations, ...bulkConversations];
  const BATCH_SIZE = 50;

  for (let i = 0; i < allConversations.length; i += BATCH_SIZE) {
    await db
      .insert(conversations)
      .values(allConversations.slice(i, i + BATCH_SIZE))
      .onConflictDoNothing();
  }
  console.log(
    `${green('✓')} Seeded ${allConversations.length} conversations (${handcraftedConversations.length} handcrafted + ${bulkConversations.length} bulk)`,
  );

  // ─── Conversation Participants ────────────────────────────────────
  // Every conversation gets its primary contact as initiator.
  // Some get additional participants (CC, BCC for email; participant for group).
  const seedParticipants: Array<{
    id: string;
    conversationId: string;
    contactId: string;
    role: string;
    joinedAt: Date;
  }> = [];

  // All handcrafted conversations get initiator
  for (const conv of handcraftedConversations) {
    seedParticipants.push({
      id: `part-${conv.id}-init`,
      conversationId: conv.id,
      contactId: conv.contactId,
      role: 'initiator',
      joinedAt: conv.startedAt,
    });
  }

  // Bob's email conversation has CC and BCC (referencing the surviving int-bob-email-02)
  seedParticipants.push(
    {
      id: 'part-bob-email-cc',
      conversationId: 'int-bob-email-02',
      contactId: 'c-alice',
      role: 'cc',
      joinedAt: hoursAgo(216),
    },
    {
      id: 'part-bob-email-bcc',
      conversationId: 'int-bob-email-02',
      contactId: 'c-staff-eve',
      role: 'bcc',
      joinedAt: hoursAgo(216),
    },
  );

  // Hannah's escalation has a staff participant
  seedParticipants.push({
    id: 'part-hannah-staff',
    conversationId: 'int-hannah-web-1',
    contactId: 'c-staff-david',
    role: 'participant',
    joinedAt: hoursAgo(1.5),
  });

  // Corporate inquiry has multiple participants
  seedParticipants.push(
    {
      id: 'part-nina-init',
      conversationId: 'int-lead-nina-1',
      contactId: 'c-lead-nina',
      role: 'initiator',
      joinedAt: hoursAgo(4),
    },
    {
      id: 'part-nina-cc',
      conversationId: 'int-lead-nina-1',
      contactId: 'c-lead-paula',
      role: 'cc',
      joinedAt: hoursAgo(3.5),
    },
  );

  await db
    .insert(conversationParticipants)
    .values(seedParticipants)
    .onConflictDoNothing();
  console.log(
    `${green('✓')} Seeded ${seedParticipants.length} conversation participants`,
  );

  // ─── Messages ────────────────────────────────────────────────────
  type SeedMessage = {
    id: string;
    conversationId: string;
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

  for (const conv of allConversations) {
    const channelType =
      conv.channelInstanceId === 'ci-wa-main'
        ? 'whatsapp'
        : conv.channelInstanceId === 'ci-email'
          ? 'email'
          : 'web';

    // Use scripted turns if available, otherwise random generic turns
    const script = SCRIPTED[conv.id];
    const turns: Array<[string, string]> = script
      ? script
      : [...GENERIC_TURNS]
          .sort(() => faker.number.float() - 0.5)
          .slice(0, faker.number.int({ min: 2, max: 5 }));

    for (let t = 0; t < turns.length; t++) {
      const [customerMsg, agentMsg] = turns[t];
      const baseH = (conv.startedAt.getTime() - Date.now()) / (-1000 * 60 * 60);
      // Space turns ~6 min apart; scripted conversations get slightly wider gaps for readability
      const gap = script ? 0.15 : 0.1;
      const customerTime = hoursAgo(Math.max(0, baseH - t * gap));
      const agentTime = hoursAgo(Math.max(0, baseH - t * gap - 0.03));

      const isLastTurn = t === turns.length - 1;
      let agentStatus: SeedMessage['status'];
      if (conv.status === 'resolved') {
        agentStatus = pick(['delivered', 'read'] as const);
      } else if (conv.status === 'failed' && isLastTurn) {
        agentStatus = 'failed';
      } else if (conv.status === 'active' && isLastTurn) {
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
        conversationId: conv.id,
        messageType: 'incoming',
        contentType: 'text',
        content: customerMsg,
        channelType,
        externalMessageId: `${prefix}.in.${faker.string.alphanumeric(12)}`,
        status: null,
        senderId: conv.contactId,
        senderType: 'contact',
        createdAt: customerTime,
      });

      seedMessages.push({
        id: `msg-${faker.string.alphanumeric(10)}`,
        conversationId: conv.id,
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

      // 10% chance of a staff private note (only on non-scripted conversations)
      if (!script && faker.number.float() < 0.1) {
        seedMessages.push({
          id: `msg-${faker.string.alphanumeric(10)}`,
          conversationId: conv.id,
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

  const resolvedConvs = allConversations.filter((s) => s.status === 'resolved');
  const seedDeadLetters = DL_ERRORS.map((error, i) => {
    const conv = resolvedConvs[i] ?? allConversations[i];
    const chType = i < 3 ? 'whatsapp' : 'email';
    return {
      id: `msg-dl-${faker.string.alphanumeric(8)}`,
      conversationId: conv.id,
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

  // ─── Activity Events (as messages with messageType='activity') ────

  type ActivitySeed = {
    type: string;
    agentId?: string;
    userId?: string;
    source: 'agent' | 'staff' | 'system';
    contactId?: string;
    conversationId: string;
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
      case 'conversation.created':
        return 'Conversation started';
      case 'conversation.resolved':
        return `Conversation resolved${evt.data.outcome ? `: ${evt.data.outcome}` : ''}`;
      case 'conversation.reopened':
        return `Conversation reopened (reopen #${evt.data.reopenCount ?? 1})`;
      case 'conversation.failed':
        return `Conversation failed: ${(evt.data.reason as string) ?? 'Unknown error'}`;
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
      conversationId: 'int-hannah-web-1',
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
      conversationId: 'int-ivan-web-1',
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
      conversationId: 'int-jenny-wa-1',
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
      conversationId: 'int-lily-wa-1',
      channelType: 'whatsapp',
      data: { reason: 'Potential PII detected', matchedTerm: 'NRIC' },
      createdAt: hoursAgo(0.3),
    },
    // Reviewed escalation (from Alice's insurance billing segment)
    {
      type: 'escalation.created',
      agentId: 'booking',
      source: 'agent',
      contactId: 'c-alice',
      conversationId: 'int-alice-wa-10',
      channelRoutingId: 'ep-wa-booking',
      channelType: 'whatsapp',
      data: { reason: 'Insurance billing question' },
      resolutionStatus: 'reviewed',
      createdAt: hoursAgo(335),
    },
    // Lifecycle events
    {
      type: 'conversation.created',
      agentId: 'booking',
      source: 'system',
      contactId: 'c-alice',
      conversationId: 'int-alice-wa-10',
      channelRoutingId: 'ep-wa-booking',
      channelType: 'whatsapp',
      data: {},
      createdAt: hoursAgo(2),
    },
    {
      type: 'conversation.reopened',
      agentId: 'booking',
      source: 'system',
      conversationId: 'int-alice-wa-10',
      data: { reopenCount: 1 },
      createdAt: hoursAgo(1),
    },
    {
      type: 'conversation.resolved',
      agentId: 'booking',
      source: 'system',
      conversationId: 'int-alice-wa-10',
      data: { outcome: 'resolved' },
      createdAt: hoursAgo(503),
    },
    {
      type: 'conversation.resolved',
      agentId: 'booking',
      source: 'system',
      conversationId: 'int-george-wa-1',
      data: { outcome: 'topic_change' },
      createdAt: hoursAgo(0.5),
    },
    {
      type: 'conversation.failed',
      agentId: 'booking',
      source: 'system',
      conversationId: 'int-fiona-web-1',
      data: { reason: 'Agent exceeded max steps' },
      createdAt: hoursAgo(47),
    },
    // Tool execution events
    {
      type: 'agent.tool_executed',
      agentId: 'booking',
      source: 'agent',
      contactId: 'c-alice',
      conversationId: 'int-alice-wa-10',
      channelType: 'whatsapp',
      data: { toolName: 'book_slot', isError: false },
      createdAt: hoursAgo(1.5),
    },
    {
      type: 'agent.tool_executed',
      agentId: 'booking',
      source: 'agent',
      contactId: 'c-bob',
      conversationId: 'int-bob-web-06',
      channelType: 'web',
      data: { toolName: 'check_availability', isError: false },
      createdAt: hoursAgo(0.8),
    },
    // Handler mode changes
    {
      type: 'handler.changed',
      agentId: 'booking',
      source: 'agent',
      conversationId: 'int-hannah-web-1',
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
      conversationId: 'int-ivan-web-1',
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
    conversationId: evt.conversationId,
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

  console.log(
    `${green('✓')} Seeded ${seedActivityMessages.length} activity events`,
  );

  // ─── Channel Sessions (WhatsApp window tracking) ─────────────────
  const waActiveConvs = allConversations.filter(
    (s) => s.channelInstanceId === 'ci-wa-main' && s.status === 'active',
  );
  const seedSessions = waActiveConvs.slice(0, 8).map((conv, i) => {
    const isExpired = i >= 6;
    const windowOpensAt = hoursAgo(isExpired ? 30 : 2);
    return {
      id: `cs-${faker.string.alphanumeric(8)}`,
      conversationId: conv.id,
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

  // Working memory and resourceMetadata columns have been dropped — skip seeding
  console.log(
    `${green('✓')} Skipped working memory (disabled feature) for ${Object.keys(WORKING_MEMORIES).length} contacts`,
  );

  // ─── Reactions + Feedback ────────────────────────────────────────
  // A few reactions and feedback entries for UI testing
  const reactionMessages = seedMessages.filter(
    (m) => m.senderType === 'agent' && m.status === 'delivered',
  );

  const seedReactions = reactionMessages.slice(0, 5).map((msg, i) => ({
    id: `react-${faker.string.alphanumeric(8)}`,
    messageId: msg.id,
    conversationId: msg.conversationId,
    contactId: allConversations.find((s) => s.id === msg.conversationId)
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
    conversationId: msg.conversationId,
    messageId: msg.id,
    rating: i < 3 ? 'positive' : 'negative',
    reason:
      i >= 3
        ? pick(['Unhelpful response', 'Wrong information', 'Too slow'])
        : null,
    contactId: allConversations.find((s) => s.id === msg.conversationId)
      ?.contactId,
    userId: null,
  }));

  if (seedFeedback.length > 0) {
    await db.insert(messageFeedback).values(seedFeedback).onConflictDoNothing();
  }
  console.log(
    `${green('✓')} Seeded ${seedReactions.length} reactions, ${seedFeedback.length} feedback`,
  );

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
    { conversationId: 'int-charlie-wa-06', labelId: 'lbl-vip' },
    { conversationId: 'int-alice-wa-10', labelId: 'lbl-vip' },
    // Urgent on Jenny and Lily
    { conversationId: 'int-jenny-wa-1', labelId: 'lbl-urgent' },
    { conversationId: 'int-lily-wa-1', labelId: 'lbl-urgent' },
    // Follow-up on Diana (abandoned)
    { conversationId: 'int-diana-wa-1', labelId: 'lbl-followup' },
    // Feedback on Bob
    { conversationId: 'int-bob-web-06', labelId: 'lbl-feedback' },
    // Bug on Fiona (failed)
    { conversationId: 'int-fiona-web-1', labelId: 'lbl-bug' },
    // Multi-label: Alice's reopened conversation gets VIP + follow-up
    { conversationId: 'int-alice-wa-10', labelId: 'lbl-followup' },
    // Bulk conversations get some labels too
    ...bulkConversations.slice(0, 8).map((conv, i) => ({
      conversationId: conv.id,
      labelId: seedLabels[i % seedLabels.length].id,
    })),
  ];

  await db
    .insert(conversationLabels)
    .values(labelAssignments)
    .onConflictDoNothing();

  // Migrate conversationLabels → contactLabels (dedup by contact+label)
  const conversationContactMap = new Map<string, string>();
  for (const conv of allConversations) {
    conversationContactMap.set(conv.id, conv.contactId);
  }
  const contactLabelSet = new Set<string>();
  const contactLabelRows: { contactId: string; labelId: string }[] = [];
  for (const la of labelAssignments) {
    const cId = conversationContactMap.get(la.conversationId);
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
    `${green('✓')} Seeded ${seedLabels.length} labels, ${labelAssignments.length} conversation assignments, ${contactLabelRows.length} contact labels`,
  );

  // ─── Broadcasts ──────────────────────────────────────────────────
  await db.insert(broadcasts).values(SEED_BROADCASTS).onConflictDoNothing();
  console.log(`${green('✓')} Seeded ${SEED_BROADCASTS.length} broadcasts`);

  // ─── Broadcast Recipients ─────────────────────────────────────────
  const seedBroadcastRecipients = buildRecipients();
  for (let i = 0; i < seedBroadcastRecipients.length; i += BATCH_SIZE) {
    await db
      .insert(broadcastRecipients)
      .values(seedBroadcastRecipients.slice(i, i + BATCH_SIZE))
      .onConflictDoNothing();
  }
  console.log(
    `${green('✓')} Seeded ${seedBroadcastRecipients.length} broadcast recipients`,
  );

  // ─── Automation Rules ────────────────────────────────────────────
  await db
    .insert(automationRules)
    .values(SEED_AUTOMATION_RULES)
    .onConflictDoNothing();
  await db
    .insert(automationRuleSteps)
    .values(SEED_AUTOMATION_RULE_STEPS)
    .onConflictDoNothing();
  console.log(
    `${green('✓')} Seeded ${SEED_AUTOMATION_RULES.length} automation rules (${SEED_AUTOMATION_RULE_STEPS.length} steps)`,
  );

  // ─── Summary ─────────────────────────────────────────────────────
  console.log(
    `\n${green('Done!')} Seeded ${allConversations.length} conversations, ${allMessages.length + seedActivityMessages.length} messages, ${seedParticipants.length} participants`,
  );
}
