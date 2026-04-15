import {
  Actions,
  Button,
  Card,
  CardText,
} from '@modules/messaging/lib/card-serialization';
import { getConstraints } from '@modules/messaging/lib/channel-constraints';
import { enqueueDelivery } from '@modules/messaging/lib/delivery';
import {
  createActivityMessage,
  insertMessage,
} from '@modules/messaging/lib/messages';
import { transition } from '@modules/messaging/lib/state-machine';
import { contacts } from '@modules/messaging/schema';
import { eq } from 'drizzle-orm';

import { parseTargetSpec, resolveTarget } from '../lib/resolve-target';
import { verifyConversationAccess } from '../lib/verify-conversation';
import type { WakeContext } from './types';
import { type CommandHandler, err, ok } from './types';

/** Insert outbound message, enqueue delivery, notify realtime. */
async function sendOutbound(
  ctx: WakeContext,
  channelType: string,
  params: {
    contentType: 'text' | 'interactive';
    content: string;
    contentData?: Record<string, unknown>;
  },
) {
  const msg = await insertMessage(ctx.db, ctx.deps.realtime, {
    conversationId: ctx.conversationId,
    messageType: 'outgoing',
    contentType: params.contentType,
    content: params.content,
    contentData: params.contentData,
    channelType,
    status: 'queued',
    senderId: ctx.agentId,
    senderType: 'agent',
  });
  await enqueueDelivery(ctx.deps.scheduler, msg.id);
  await ctx.deps.realtime
    .notify({
      table: 'conversations',
      id: ctx.conversationId,
      action: 'new-message',
    })
    .catch(() => {});
}

// ─── reply ──────────────────────────────────────────────────────────

const reply: CommandHandler = async (positional, _flags, ctx) => {
  const message = positional.join(' ').trim();
  if (!message) return err('Usage: vobase reply <message>');

  const check = await verifyConversationAccess(
    ctx.deps,
    ctx.conversationId,
    ctx.contactId,
  );
  if (!check.success) return err(check.message);

  await sendOutbound(ctx, check.channelType, {
    contentType: 'text',
    content: message,
  });

  return ok('Reply sent.');
};

// ─── card ───────────────────────────────────────────────────────────

const card: CommandHandler = async (positional, flags, ctx) => {
  const body = positional.join(' ').trim();
  if (!body)
    return err(
      'Usage: vobase card <body> [--title <title>] [--buttons "a,b,c"]',
    );

  const check = await verifyConversationAccess(
    ctx.deps,
    ctx.conversationId,
    ctx.contactId,
  );
  if (!check.success) return err(check.message);

  const constraints = getConstraints(check.channelType);

  if (body.length > constraints.maxBodyLength) {
    return err(
      `Body exceeds ${constraints.name} limit of ${constraints.maxBodyLength} chars (got ${body.length}).`,
    );
  }

  const buttonLabels = flags.buttons
    ? flags.buttons
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  if (
    constraints.maxButtons !== null &&
    buttonLabels.length > constraints.maxButtons
  ) {
    return err(
      `${constraints.name} allows max ${constraints.maxButtons} buttons, got ${buttonLabels.length}.`,
    );
  }

  for (const label of buttonLabels) {
    if (label.length > constraints.maxButtonLabelLength) {
      return err(
        `Button label "${label}" exceeds ${constraints.name} limit of ${constraints.maxButtonLabelLength} chars.`,
      );
    }
  }

  const actionButtons = buttonLabels.map((label, _i) =>
    Button({ id: `chat:${JSON.stringify(label)}`, label }),
  );

  const cardElement = Card({
    ...(flags.title ? { title: flags.title } : {}),
    children: [
      CardText(body),
      ...(actionButtons.length > 0 ? [Actions(actionButtons)] : []),
    ],
  });

  await sendOutbound(ctx, check.channelType, {
    contentType: 'interactive',
    content: body,
    contentData: { card: cardElement },
  });

  return ok('Card sent.');
};

// ─── resolve ────────────────────────────────────────────────────────

const resolve: CommandHandler = async (_positional, _flags, ctx) => {
  const result = await transition(ctx.deps, ctx.conversationId, {
    type: 'SET_RESOLVING',
  });

  if (!result.ok) return err(result.error);

  return ok('Conversation will be completed after this response.');
};

// ─── reassign ───────────────────────────────────────────────────────

const reassign: CommandHandler = async (positional, flags, ctx) => {
  const spec = positional[0];
  if (!spec)
    return err('Usage: vobase reassign <type:value> [--summary <reason>]');

  const target = parseTargetSpec(spec);
  if (!target)
    return err(
      `Invalid target spec: "${spec}". Use role:name, user:id, or agent:id.`,
    );

  const resolvedAssignee = await resolveTarget(ctx.db, target);
  if (!resolvedAssignee)
    return err(`Could not resolve target: ${target.type}=${target.value}`);

  const result = await transition(ctx.deps, ctx.conversationId, {
    type: 'REASSIGN',
    assignee: resolvedAssignee,
    reason: flags.summary ?? 'Reassigned by agent',
  });

  if (!result.ok) return err(result.error);

  return ok(`Conversation reassigned to ${resolvedAssignee}.`);
};

// ─── hold ───────────────────────────────────────────────────────────

const hold: CommandHandler = async (_positional, flags, ctx) => {
  const reason = flags.reason ?? 'Placed on hold by agent';

  const result = await transition(ctx.deps, ctx.conversationId, {
    type: 'HOLD',
    reason,
  });

  if (!result.ok) return err(result.error);

  return ok('Conversation placed on hold.');
};

// ─── mention ────────────────────────────────────────────────────────

const mention: CommandHandler = async (positional, _flags, ctx) => {
  const spec = positional[0];
  if (!spec || positional.length < 2) {
    return err('Usage: vobase mention <type:value> <note>');
  }

  const target = parseTargetSpec(spec);
  if (!target)
    return err(`Invalid target spec: "${spec}". Use role:name or user:id.`);

  const targetId = await resolveTarget(ctx.db, target);
  if (!targetId)
    return err(`Could not resolve target: ${target.type}=${target.value}`);

  const note = positional.slice(1).join(' ').trim();

  await insertMessage(ctx.db, ctx.deps.realtime, {
    conversationId: ctx.conversationId,
    messageType: 'activity',
    contentType: 'system',
    content: `@${targetId}: ${note}`,
    contentData: {
      eventType: 'agent.mention',
      note,
      targetId,
    },
    senderId: ctx.agentId,
    senderType: 'agent',
    private: true,
    mentions: [{ targetId, targetType: 'user' }],
  });

  return ok('Note sent.');
};

// ─── draft ──────────────────────────────────────────────────────────

const draft: CommandHandler = async (positional, flags, ctx) => {
  const content = positional.join(' ').trim();
  if (!content)
    return err('Usage: vobase draft <message> [--reviewer <type:value>]');

  let reviewerId: string | undefined;
  if (flags.reviewer) {
    const target = parseTargetSpec(flags.reviewer);
    if (!target) return err(`Invalid reviewer spec: "${flags.reviewer}".`);
    const resolved = await resolveTarget(ctx.db, target);
    if (!resolved)
      return err(`Could not resolve reviewer: ${target.type}=${target.value}`);
    reviewerId = resolved;
  }

  await insertMessage(ctx.db, ctx.deps.realtime, {
    conversationId: ctx.conversationId,
    messageType: 'activity',
    contentType: 'system',
    content: 'agent.draft_created',
    contentData: {
      eventType: 'agent.draft_created',
      draftContent: content,
      ...(reviewerId ? { reviewerId } : {}),
    },
    senderId: ctx.agentId,
    senderType: 'agent',
    private: true,
    ...(reviewerId
      ? { mentions: [{ targetId: reviewerId, targetType: 'user' as const }] }
      : {}),
  });

  const who = reviewerId ? ` and ${reviewerId} notified for review` : '';
  return ok(`Draft created${who}.`);
};

// ─── topic ──────────────────────────────────────────────────────────

const topic: CommandHandler = async (positional, flags, ctx) => {
  const summary = positional.join(' ').trim();
  if (!summary)
    return err('Usage: vobase topic <summary> [--next <next topic>]');

  await createActivityMessage(ctx.db, ctx.deps.realtime, {
    conversationId: ctx.conversationId,
    eventType: 'topic.changed',
    data: {
      summary,
      ...(flags.next ? { nextTopic: flags.next } : {}),
    },
  });

  return ok('Topic marker inserted.');
};

// ─── remind ─────────────────────────────────────────────────────────

const remind: CommandHandler = async (positional, flags, ctx) => {
  const contactId = positional[0];
  const message = positional.slice(1).join(' ').trim();
  if (!contactId || !message) {
    return err(
      'Usage: vobase remind <contactId> <message> --channel <whatsapp|email>',
    );
  }

  const channel = flags.channel;
  if (!channel || !['whatsapp', 'email'].includes(channel)) {
    return err('--channel flag required (whatsapp or email).');
  }

  const [contact] = await ctx.db
    .select({ phone: contacts.phone, email: contacts.email })
    .from(contacts)
    .where(eq(contacts.id, contactId));

  if (!contact) return err('Contact not found.');

  if (channel === 'whatsapp') {
    if (!contact.phone) return err('Contact has no phone number.');
    const result = await ctx.deps.channels.whatsapp.send({
      to: contact.phone,
      text: message,
    });
    if (!result.success) return err(result.error ?? 'WhatsApp send failed.');
    return ok('Reminder sent via WhatsApp.');
  }

  if (channel === 'email') {
    if (!contact.email) return err('Contact has no email address.');
    const result = await ctx.deps.channels.email.send({
      to: contact.email,
      subject: 'Reminder',
      html: `<p>${message}</p>`,
    });
    if (!result.success) return err(result.error ?? 'Email send failed.');
    return ok('Reminder sent via email.');
  }

  return err(`Unsupported channel: ${channel}`);
};

// ─── follow-up ──────────────────────────────────────────────────────

const followUp: CommandHandler = async (positional, flags, ctx) => {
  const delayStr = positional[0];
  if (!delayStr)
    return err('Usage: vobase follow-up <delaySeconds> [--reason <reason>]');

  const delaySeconds = Number.parseInt(delayStr, 10);
  if (
    Number.isNaN(delaySeconds) ||
    delaySeconds < 60 ||
    delaySeconds > 86400 * 7
  ) {
    return err('Delay must be an integer between 60 and 604800 seconds.');
  }

  const reason = flags.reason ?? 'Scheduled follow-up';

  await ctx.deps.scheduler.add(
    'agents:agent-wake',
    {
      agentId: ctx.agentId,
      contactId: ctx.contactId,
      conversationId: ctx.conversationId,
      trigger: 'scheduled_followup' as const,
      payload: { reason },
    },
    { startAfter: delaySeconds },
  );

  return ok(`Follow-up scheduled in ${delaySeconds} seconds: ${reason}`);
};

// ─── Registry ───────────────────────────────────────────────────────

export const conversationCommands: Record<string, CommandHandler> = {
  reply,
  card,
  resolve,
  reassign,
  hold,
  mention,
  draft,
  topic,
  remind,
  'follow-up': followUp,
};
