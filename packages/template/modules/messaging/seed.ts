import type { VobaseDb } from '@vobase/core';

import { initMastra } from '../../mastra';
import { getDefaultAgent } from '../../mastra/agents';
import type { SeedContext } from '../seed-types';
import { createMemoryThread, saveInboundMessage } from './lib/memory-bridge';
import {
  msgContacts,
  msgConversations,
  msgInboxes,
  msgLabels,
  msgTeams,
} from './schema';

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

export default async function seed({ db, userId }: SeedContext): Promise<void> {
  const msgResult = await seedMessaging(db, userId);
  if (msgResult.conversations > 0) {
    console.log(
      green('✓') +
        ` Created ${msgResult.conversations} sample conversations, ${msgResult.contacts} contacts`,
    );
  } else {
    console.log(dim('✓ Messaging data already exists. Skipping.'));
  }
}

export async function seedMessaging(
  db: VobaseDb,
  userId: string,
): Promise<{ conversations: number; contacts: number }> {
  const existing = await db.select().from(msgConversations).limit(1);
  if (existing.length > 0) return { conversations: 0, contacts: 0 };

  // ── Teams ────────────────────────────────────────────────────────────
  const [supportTeam, salesTeam] = await db
    .insert(msgTeams)
    .values([
      { name: 'Support', description: 'Customer support team' },
      { name: 'Sales', description: 'Sales and pre-sales team' },
    ])
    .returning();

  // ── Inboxes ──────────────────────────────────────────────────────────
  const [webInbox, whatsappInbox, emailInbox] = await db
    .insert(msgInboxes)
    .values([
      {
        name: 'Web Support',
        channel: 'web',
        defaultAgentId: 'assistant',
        teamId: supportTeam.id,
        enabled: true,
      },
      {
        name: 'WhatsApp Sales',
        channel: 'whatsapp',
        defaultAgentId: 'assistant',
        teamId: salesTeam.id,
        enabled: true,
      },
      {
        name: 'Email Support',
        channel: 'email',
        defaultAgentId: 'assistant',
        teamId: supportTeam.id,
        enabled: true,
      },
    ])
    .returning();

  // ── Labels ───────────────────────────────────────────────────────────
  await db.insert(msgLabels).values([
    { name: 'billing', color: '#f59e0b' },
    { name: 'technical', color: '#3b82f6' },
    { name: 'general', color: '#6b7280' },
    { name: 'sales', color: '#10b981' },
    { name: 'urgent', color: '#ef4444' },
  ]);

  // ── Contacts ─────────────────────────────────────────────────────────
  const contacts = await db
    .insert(msgContacts)
    .values([
      {
        name: 'Alice Nguyen',
        email: 'alice.nguyen@example.com',
        phone: '+14155550101',
        channel: 'web',
      },
      {
        name: 'Bob Caldwell',
        email: 'bob.caldwell@example.com',
        phone: '+14155550102',
        channel: 'email',
      },
      {
        name: 'Carmen Silva',
        email: 'carmen.silva@example.com',
        phone: '+14155550103',
        channel: 'whatsapp',
      },
      {
        name: 'David Park',
        email: 'david.park@example.com',
        phone: '+14155550104',
        channel: 'web',
      },
      {
        name: 'Eva Müller',
        email: 'eva.mueller@example.com',
        phone: '+14155550105',
        channel: 'email',
      },
    ])
    .returning();

  const [alice, bob, carmen, david, eva] = contacts;

  // ── Agent ────────────────────────────────────────────────────────────
  const registered = getDefaultAgent();
  if (!registered) return { conversations: 0, contacts: contacts.length };
  const defaultAgent = registered.meta;

  // Initialize Mastra Memory (needed for seed context where server hasn't started)
  try {
    await initMastra(db as unknown as { $client: unknown });
  } catch {
    // Already initialized or storage not available — continue
  }

  // ── Conversation definitions ─────────────────────────────────────────
  type ConvDef = {
    title: string;
    status: 'open' | 'pending' | 'resolved' | 'snoozed';
    handler: 'ai' | 'human' | 'unassigned';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    channel: 'web' | 'whatsapp' | 'email';
    inboxId: string;
    contactId: string;
    escalationReason?: string;
    escalationSummary?: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
  };

  const convDefs: ConvDef[] = [
    {
      title: 'Billing question about invoice #INV-0042',
      status: 'open',
      handler: 'ai',
      priority: 'medium',
      channel: 'web',
      inboxId: webInbox.id,
      contactId: alice.id,
      messages: [
        {
          role: 'user',
          content:
            'Hi, I have a question about invoice #INV-0042. The total seems higher than expected — can you help?',
        },
        {
          role: 'assistant',
          content:
            'Of course! Invoice #INV-0042 includes your base subscription plus a one-time setup fee of $150 for the new workspace. Would you like me to send a detailed breakdown to your email?',
        },
      ],
    },
    {
      title: 'Technical support for API integration',
      status: 'pending',
      handler: 'human',
      priority: 'high',
      channel: 'web',
      inboxId: webInbox.id,
      contactId: david.id,
      escalationReason:
        'Customer has an active production outage caused by webhook 401 errors.',
      escalationSummary:
        'Webhook endpoint returns 401 after rotating API key. Customer needs immediate help verifying the new key is correctly set in their integration config.',
      messages: [
        {
          role: 'user',
          content:
            'Our webhooks stopped working after we rotated our API key. We are getting 401 errors and this is blocking our production pipeline.',
        },
        {
          role: 'assistant',
          content:
            'I understand this is urgent. I have escalated your case to our technical team. While you wait, please ensure the new API key is saved in Settings → Integrations → Webhook Auth. A human agent will follow up within 15 minutes.',
        },
      ],
    },
    {
      title: 'Sales inquiry about enterprise plan',
      status: 'open',
      handler: 'ai',
      priority: 'high',
      channel: 'whatsapp',
      inboxId: whatsappInbox.id,
      contactId: carmen.id,
      messages: [
        {
          role: 'user',
          content:
            'Hello! We are a team of 50 and looking for an enterprise plan. What does it include and what are the pricing tiers?',
        },
        {
          role: 'assistant',
          content:
            'Great to hear from you! Our Enterprise plan includes unlimited seats, SSO, dedicated support, custom SLAs, and audit logs. Pricing is based on usage tier. Can I connect you with one of our account executives to discuss your specific needs?',
        },
      ],
    },
    {
      title: 'Password reset not arriving by email',
      status: 'resolved',
      handler: 'ai',
      priority: 'low',
      channel: 'email',
      inboxId: emailInbox.id,
      contactId: bob.id,
      messages: [
        {
          role: 'user',
          content:
            'I requested a password reset 30 minutes ago but never received the email. My address is bob.caldwell@example.com.',
        },
        {
          role: 'assistant',
          content:
            'I checked our delivery logs and the email was sent successfully. It may have landed in your spam folder. Please check there or whitelist noreply@vobase.io. I have resent the link just in case — it expires in 1 hour.',
        },
      ],
    },
    {
      title: 'How to export conversation history',
      status: 'open',
      handler: 'unassigned',
      priority: 'low',
      channel: 'web',
      inboxId: webInbox.id,
      contactId: alice.id,
      messages: [
        {
          role: 'user',
          content:
            'Is there a way to export my conversation history as a CSV or PDF? I need it for compliance purposes.',
        },
        {
          role: 'assistant',
          content:
            'Yes! Go to Settings → Data Export, select "Conversations", choose your date range, and click Export. CSV and JSON formats are available. PDF export is on our roadmap for Q2.',
        },
      ],
    },
    {
      title: 'WhatsApp channel keeps disconnecting',
      status: 'pending',
      handler: 'human',
      priority: 'urgent',
      channel: 'whatsapp',
      inboxId: whatsappInbox.id,
      contactId: carmen.id,
      escalationReason:
        'Repeated channel disconnections are affecting live customer conversations. Automated reconnect is not recovering the session.',
      escalationSummary:
        'WhatsApp Business session drops every 2–3 hours. Logs show QR code expiry before reconnect completes. Customer requires human review of their Meta Business Manager permissions.',
      messages: [
        {
          role: 'user',
          content:
            'Our WhatsApp channel disconnects every few hours and we lose messages. This is happening in production and customers are not receiving our replies.',
        },
        {
          role: 'assistant',
          content:
            'I am sorry for the disruption. This looks like a session token expiry issue. I have escalated this to our infrastructure team for immediate investigation. Please do not revoke the current WhatsApp session — our engineer will need it. Expected response: 30 minutes.',
        },
      ],
    },
    {
      title: 'Upgrade from Starter to Growth plan',
      status: 'resolved',
      handler: 'ai',
      priority: 'medium',
      channel: 'email',
      inboxId: emailInbox.id,
      contactId: eva.id,
      messages: [
        {
          role: 'user',
          content:
            'I would like to upgrade our account from the Starter plan to the Growth plan. How do I do that without losing existing data?',
        },
        {
          role: 'assistant',
          content:
            'Upgrading is fully non-destructive — all your data, conversations, and integrations are preserved. Go to Settings → Billing → Change Plan, select Growth, and confirm. The change takes effect immediately and you will be charged pro-rata for the remainder of the billing cycle.',
        },
      ],
    },
    {
      title: 'Feature request: bulk conversation assignment',
      status: 'snoozed',
      handler: 'unassigned',
      priority: 'low',
      channel: 'web',
      inboxId: webInbox.id,
      contactId: david.id,
      messages: [
        {
          role: 'user',
          content:
            'It would be really helpful to assign multiple conversations to an agent at once instead of one by one. Is this planned?',
        },
        {
          role: 'assistant',
          content:
            'Bulk assignment is on our roadmap! We are tracking this for our Q3 release. I have added your vote to the feature request. We will notify you when it ships. In the meantime, you can use the Shift+Click multi-select to speed up individual assignments.',
        },
      ],
    },
    {
      title: 'Custom domain setup for email inbox',
      status: 'open',
      handler: 'ai',
      priority: 'medium',
      channel: 'email',
      inboxId: emailInbox.id,
      contactId: bob.id,
      messages: [
        {
          role: 'user',
          content:
            'We want to use support@ourcompany.com instead of the default address. How do we set up a custom sending domain?',
        },
        {
          role: 'assistant',
          content:
            'You can configure a custom sending domain under Settings → Email → Custom Domain. You will need to add three DNS records (SPF, DKIM, and DMARC) to your domain registrar. The setup wizard will generate the exact values — verification usually completes within 30 minutes.',
        },
      ],
    },
    {
      title: 'GDPR data deletion request for a contact',
      status: 'open',
      handler: 'human',
      priority: 'urgent',
      channel: 'email',
      inboxId: emailInbox.id,
      contactId: eva.id,
      messages: [
        {
          role: 'user',
          content:
            'We have received a GDPR right-to-erasure request for one of our contacts. How do we permanently delete all their data including conversation history?',
        },
        {
          role: 'assistant',
          content:
            'GDPR erasure requests are handled under Settings → Privacy → Data Deletion. Enter the contact email and confirm — this permanently removes all PII, conversation content, and associated records. For audit trail purposes, an anonymized deletion record is retained. I am also flagging this for our compliance team to assist.',
        },
      ],
    },
  ];

  // ── Insert conversations and seed memory threads ───────────────────
  let created = 0;

  for (const def of convDefs) {
    const now = new Date();
    const escalationAt = def.escalationReason ? now : undefined;

    const [conversation] = await db
      .insert(msgConversations)
      .values({
        title: def.title,
        agentId: defaultAgent.id,
        userId,
        contactId: def.contactId,
        channel: def.channel,
        status: def.status,
        handler: def.handler,
        priority: def.priority,
        inboxId: def.inboxId,
        escalationReason: def.escalationReason ?? null,
        escalationSummary: def.escalationSummary ?? null,
        escalationAt: escalationAt ?? null,
        resolvedAt: def.status === 'resolved' ? now : null,
        snoozedUntil:
          def.status === 'snoozed'
            ? new Date(now.getTime() + 24 * 60 * 60 * 1000)
            : null,
      })
      .returning();

    // Seed Mastra memory thread
    try {
      await createMemoryThread({
        threadId: conversation.id,
        resourceId: userId,
        title: def.title,
      });

      for (const msg of def.messages) {
        await saveInboundMessage({
          threadId: conversation.id,
          resourceId: userId,
          content: msg.content,
          role: msg.role,
        });
      }
    } catch {
      // Memory not initialized during seed — non-fatal
    }

    created++;
  }

  return { conversations: created, contacts: contacts.length };
}
