import {
  AlertTriangleIcon,
  BotIcon,
  CheckIcon,
  ShieldIcon,
  TagIcon,
  WrenchIcon,
  ZapIcon,
} from 'lucide-react';

interface ActivityEvent {
  /** eventType stored in content field for activity messages */
  content: string;
  contentData: Record<string, unknown> | null;
}

/** Activity event types meaningful enough to show in the conversation timeline.
 *  Low-value events (message.read, message.outbound_queued, agent.tool_executed)
 *  are excluded — their info is already visible on message bubbles or redundant. */
const TIMELINE_VISIBLE_EVENTS = new Set([
  'escalation.created',
  'handler.changed',
  'session.created',
  'session.completed',
  'session.failed',
  'conversation.created',
  'conversation.completed',
  'conversation.failed',
  'conversation.claimed',
  'conversation.unassigned',
  'guardrail.block',
  'guardrail.warn',
  'agent.draft_generated',
  'attention.reviewed',
  'attention.dismissed',
  'label.added',
  'label.removed',
]);

/** Whether an activity event type should be rendered in the conversation timeline */
export function isTimelineVisibleEvent(eventType: string): boolean {
  return TIMELINE_VISIBLE_EVENTS.has(eventType);
}

/** Human-readable description for an activity event */
export function activityDescription(event: ActivityEvent): string {
  const type = event.content;
  const data = event.contentData ?? {};
  switch (type) {
    case 'session.created':
    case 'conversation.created':
      return 'Conversation started';
    case 'session.completed':
    case 'conversation.completed':
      return 'Conversation resolved';
    case 'session.failed':
    case 'conversation.failed':
      return 'Conversation failed';
    case 'conversation.claimed':
      return `Assigned to ${(data.assignee as string) ?? 'staff'}`;
    case 'conversation.unassigned':
      return 'Unassigned from staff';
    case 'escalation.created':
      return `Escalated — ${(data.reason as string)?.slice(0, 60) ?? 'needs attention'}`;
    case 'handler.changed':
      return `Mode changed to ${(data.to as string) ?? 'unknown'}`;
    case 'agent.draft_generated':
      return 'Agent draft ready for review';
    case 'guardrail.block':
      return 'Message blocked by guardrail';
    case 'guardrail.warn':
      return `Guardrail warning — ${(data.reason as string)?.slice(0, 60) ?? 'policy check'}`;
    case 'attention.reviewed':
      return 'Escalation reviewed';
    case 'attention.dismissed':
      return 'Escalation dismissed';
    case 'label.added':
      return `Label added: ${(data.labelTitle as string) ?? 'unknown'}`;
    case 'label.removed':
      return `Label removed: ${(data.labelTitle as string) ?? 'unknown'}`;
    default:
      return type.replace(/\./g, ' ');
  }
}

/** Icon for an activity event type */
export function activityIcon(type: string) {
  if (type.startsWith('escalation'))
    return <AlertTriangleIcon className="size-3 text-red-500" />;
  if (type === 'handler.changed')
    return <ZapIcon className="size-3 text-yellow-500" />;
  if (
    type === 'session.completed' ||
    type === 'conversation.completed' ||
    type === 'attention.reviewed'
  )
    return <CheckIcon className="size-3 text-green-500" />;
  if (type === 'session.failed' || type === 'conversation.failed')
    return <AlertTriangleIcon className="size-3 text-red-500" />;
  if (type === 'conversation.claimed' || type === 'conversation.unassigned')
    return <ZapIcon className="size-3 text-blue-500" />;
  if (type === 'agent.draft_generated')
    return <WrenchIcon className="size-3 text-amber-500" />;
  if (type.startsWith('guardrail'))
    return <ShieldIcon className="size-3 text-orange-500" />;
  if (type === 'session.created' || type === 'conversation.created')
    return <BotIcon className="size-3 text-violet-500" />;
  if (type === 'label.added' || type === 'label.removed')
    return <TagIcon className="size-3 text-violet-500" />;
  return <ZapIcon className="size-3 text-muted-foreground" />;
}
