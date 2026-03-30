import {
  AlertTriangleIcon,
  BotIcon,
  CheckIcon,
  ShieldIcon,
  WrenchIcon,
  ZapIcon,
} from 'lucide-react';

interface ActivityEvent {
  type: string;
  data: Record<string, unknown> | null;
}

/** Human-readable description for an activity event */
export function activityDescription(event: ActivityEvent): string {
  const data = event.data ?? {};
  switch (event.type) {
    case 'session.created':
      return 'Conversation started';
    case 'session.completed':
      return 'Conversation resolved';
    case 'session.failed':
      return 'Conversation failed';
    case 'escalation.created':
      return `Escalated — ${(data.reason as string)?.slice(0, 60) ?? 'needs attention'}`;
    case 'handler.changed':
      return `Mode changed to ${(data.to as string) ?? 'unknown'}`;
    case 'message.inbound_human_mode':
      return (data.content as string)?.slice(0, 60) ?? 'Message from visitor';
    case 'message.outbound_queued':
      return 'AI response sent';
    case 'agent.tool_executed':
      return `Used ${(data.toolName as string)?.replace(/_/g, ' ') ?? 'a tool'}`;
    case 'guardrail.block':
      return 'Message blocked by guardrail';
    case 'attention.reviewed':
      return 'Escalation reviewed';
    case 'attention.dismissed':
      return 'Escalation dismissed';
    default:
      return event.type.replace(/\./g, ' ');
  }
}

/** Icon for an activity event type */
export function activityIcon(type: string) {
  if (type.startsWith('escalation'))
    return <AlertTriangleIcon className="size-3 text-red-500" />;
  if (type === 'handler.changed')
    return <ZapIcon className="size-3 text-yellow-500" />;
  if (type === 'session.completed' || type === 'attention.reviewed')
    return <CheckIcon className="size-3 text-green-500" />;
  if (type === 'session.failed')
    return <AlertTriangleIcon className="size-3 text-red-500" />;
  if (type === 'agent.tool_executed')
    return <WrenchIcon className="size-3 text-blue-500" />;
  if (type.startsWith('guardrail'))
    return <ShieldIcon className="size-3 text-orange-500" />;
  if (type === 'session.created')
    return <BotIcon className="size-3 text-violet-500" />;
  return <ZapIcon className="size-3 text-muted-foreground" />;
}
