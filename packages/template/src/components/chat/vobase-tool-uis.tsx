import { makeAssistantToolUI } from '@assistant-ui/react';

import { ToolFallback } from '@/components/assistant-ui/tool-fallback';
import { ApprovalCard } from '@/components/tool-ui/approval-card';
import { CitationList } from '@/components/tool-ui/citation';
import { DataTable } from '@/components/tool-ui/data-table';
import { OrderSummary } from '@/components/tool-ui/order-summary';
import { ProgressTracker } from '@/components/tool-ui/progress-tracker';
import { StatsDisplay } from '@/components/tool-ui/stats-display';

// ─── Adapter helpers ─────────────────────────────────────────────────

/** Wrap tool-ui output with vertical spacing */
function ToolSpacing({ children }: { children: React.ReactNode }) {
  return <div className="my-2">{children}</div>;
}

type AnyRecord = Record<string, unknown>;

function asRecord(v: unknown): AnyRecord | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as AnyRecord)
    : null;
}

/** Convert key-value record into StatsDisplay stats array */
function recordToStats(r: AnyRecord) {
  return Object.entries(r)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([key, value]) => ({
      key,
      label: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      value: String(value),
      format: { kind: 'text' as const },
    }));
}

// ─── search_knowledge_base ───────────────────────────────────────────

const SearchKBToolUI = makeAssistantToolUI({
  toolName: 'search_knowledge_base',
  render: (props) => {
    if (props.status?.type === 'running') return <ToolFallback {...props} />;

    const r = asRecord(props.result);
    if (!r?.found || !Array.isArray(r.results) || r.results.length === 0)
      return <ToolFallback {...props} />;

    const citations = (r.results as AnyRecord[]).map((item, i) => ({
      id: String(item.documentId ?? `kb-${i}`),
      href: `/documents/${item.documentId ?? i}`,
      title: String(item.source ?? 'Document'),
      snippet: String(item.content ?? ''),
      type: 'document' as const,
    }));

    return (
      <ToolSpacing>
        <CitationList id="kb-results" citations={citations} />
      </ToolSpacing>
    );
  },
});

// ─── retrieve_context ────────────────────────────────────────────────

const RetrieveContextToolUI = makeAssistantToolUI({
  toolName: 'retrieve_context',
  render: (props) => {
    if (props.status?.type === 'running') return <ToolFallback {...props} />;

    const r = asRecord(props.result);
    if (!r || !Array.isArray(r.results) || r.results.length === 0)
      return <ToolFallback {...props} />;

    const citations = (r.results as AnyRecord[]).map((item, i) => ({
      id: String(item.documentId ?? item.id ?? `ctx-${i}`),
      href: String(item.url ?? `#ctx-${i}`),
      title: String(item.source ?? item.title ?? 'Source'),
      snippet: String(item.content ?? item.text ?? ''),
      type: 'document' as const,
    }));

    return (
      <ToolSpacing>
        <CitationList id="context-results" citations={citations} />
      </ToolSpacing>
    );
  },
});

// ─── get_contact_info ────────────────────────────────────────────────

const GetContactInfoToolUI = makeAssistantToolUI({
  toolName: 'get_contact_info',
  render: (props) => {
    if (props.status?.type === 'running') return <ToolFallback {...props} />;

    const r = asRecord(props.result);
    if (!r) return <ToolFallback {...props} />;

    const stats = recordToStats(r);
    if (stats.length === 0) return <ToolFallback {...props} />;

    return (
      <ToolSpacing>
        <StatsDisplay id="contact-info" title="Contact Info" stats={stats} />
      </ToolSpacing>
    );
  },
});

// ─── get_contact_memory ──────────────────────────────────────────────

const GetContactMemoryToolUI = makeAssistantToolUI({
  toolName: 'get_contact_memory',
  render: (props) => {
    if (props.status?.type === 'running') return <ToolFallback {...props} />;

    const r = asRecord(props.result);
    if (!r) return <ToolFallback {...props} />;

    const stats = recordToStats(r);
    if (stats.length === 0) return <ToolFallback {...props} />;

    return (
      <ToolSpacing>
        <StatsDisplay id="contact-memory" title="Memory Recall" stats={stats} />
      </ToolSpacing>
    );
  },
});

// ─── consult_human ───────────────────────────────────────────────────

const ConsultHumanToolUI = makeAssistantToolUI({
  toolName: 'consult_human',
  render: (props) => {
    if (props.status?.type === 'running') return <ToolFallback {...props} />;

    const a = asRecord(props.args);
    const r = asRecord(props.result);
    if (!r) return <ToolFallback {...props} />;

    const consultStatus = String(r.status ?? 'pending');
    const choice =
      consultStatus === 'error'
        ? ('denied' as const)
        : consultStatus === 'resolved'
          ? ('approved' as const)
          : undefined;

    return (
      <ToolSpacing>
        <ApprovalCard
          id={String(r.consultationId ?? 'consult')}
          title="Staff Consultation"
          description={a?.reason ? String(a.reason) : undefined}
          metadata={[
            ...(a?.message
              ? [{ key: 'message', value: String(a.message) }]
              : []),
            { key: 'status', value: consultStatus },
          ]}
          choice={choice}
        />
      </ToolSpacing>
    );
  },
});

// ─── check_availability ──────────────────────────────────────────────

const CheckAvailabilityToolUI = makeAssistantToolUI({
  toolName: 'check_availability',
  render: (props) => {
    if (props.status?.type === 'running') return <ToolFallback {...props} />;

    const r = asRecord(props.result);
    if (!r || !Array.isArray(r.slots)) return <ToolFallback {...props} />;

    const columns = [
      {
        key: 'datetime' as const,
        label: 'Date & Time',
        format: { kind: 'date' as const, dateFormat: 'short' as const },
      },
      {
        key: 'available' as const,
        label: 'Status',
        format: {
          kind: 'status' as const,
          statusMap: {
            true: { tone: 'success' as const, label: 'Available' },
            false: { tone: 'danger' as const, label: 'Booked' },
          },
        },
      },
    ];

    const data = (r.slots as AnyRecord[]).map((slot) => ({
      datetime: String(slot.datetime),
      available: String(slot.available),
    }));

    return (
      <ToolSpacing>
        <DataTable
          id="availability"
          columns={columns}
          data={data}
          rowIdKey="datetime"
        />
      </ToolSpacing>
    );
  },
});

// ─── book_slot ───────────────────────────────────────────────────────

const BookSlotToolUI = makeAssistantToolUI({
  toolName: 'book_slot',
  render: (props) => {
    if (props.status?.type === 'running') return <ToolFallback {...props} />;

    const a = asRecord(props.args);
    const r = asRecord(props.result);
    if (!r) return <ToolFallback {...props} />;

    return (
      <ToolSpacing>
        <OrderSummary
          id={String(r.bookingId ?? 'booking')}
          title="Booking Confirmation"
          variant={r.confirmed ? 'receipt' : 'summary'}
          items={[
            {
              id: 'service',
              name: String(a?.service ?? 'Service'),
              description: `Scheduled: ${String(r.datetime ?? a?.datetime ?? '')}`,
              unitPrice: 0,
            },
          ]}
          pricing={{ subtotal: 0, total: 0 }}
          choice={
            r.confirmed
              ? {
                  action: 'confirm' as const,
                  orderId: String(r.bookingId),
                  confirmedAt: new Date().toISOString(),
                }
              : undefined
          }
        />
      </ToolSpacing>
    );
  },
});

// ─── cancel_booking ──────────────────────────────────────────────────

const CancelBookingToolUI = makeAssistantToolUI({
  toolName: 'cancel_booking',
  render: (props) => {
    if (props.status?.type === 'running') return <ToolFallback {...props} />;

    const a = asRecord(props.args);
    const r = asRecord(props.result);
    if (!r) return <ToolFallback {...props} />;

    return (
      <ToolSpacing>
        <ApprovalCard
          id={String(a?.bookingId ?? 'cancel')}
          title="Booking Cancellation"
          description={a?.reason ? String(a.reason) : 'Cancellation requested'}
          variant="destructive"
          metadata={[{ key: 'bookingId', value: String(a?.bookingId ?? '') }]}
          choice={r.cancelled ? 'approved' : 'denied'}
        />
      </ToolSpacing>
    );
  },
});

// ─── reschedule_booking ──────────────────────────────────────────────

const RescheduleBookingToolUI = makeAssistantToolUI({
  toolName: 'reschedule_booking',
  render: (props) => {
    if (props.status?.type === 'running') return <ToolFallback {...props} />;

    const r = asRecord(props.result);
    if (!r) return <ToolFallback {...props} />;

    return (
      <ToolSpacing>
        <ProgressTracker
          id={String(r.bookingId ?? 'reschedule')}
          steps={[
            {
              id: 'reschedule',
              label: r.confirmed
                ? `Rescheduled to ${String(r.newDatetime)}`
                : 'Reschedule failed',
              status: r.confirmed ? 'completed' : 'failed',
            },
          ]}
        />
      </ToolSpacing>
    );
  },
});

// ─── send_reminder ───────────────────────────────────────────────────

const SendReminderToolUI = makeAssistantToolUI({
  toolName: 'send_reminder',
  render: (props) => {
    if (props.status?.type === 'running') return <ToolFallback {...props} />;

    const a = asRecord(props.args);
    const r = asRecord(props.result);
    if (!r) return <ToolFallback {...props} />;

    return (
      <ToolSpacing>
        <ProgressTracker
          id={String(r.messageId ?? 'reminder')}
          steps={[
            {
              id: 'send',
              label: r.sent
                ? `Sent via ${String(a?.channel ?? 'channel')}`
                : `Failed: ${String(r.error ?? 'unknown error')}`,
              status: r.sent ? 'completed' : 'failed',
            },
          ]}
        />
      </ToolSpacing>
    );
  },
});

// ─── escalate ────────────────────────────────────────────────────────

const EscalateToolUI = makeAssistantToolUI({
  toolName: 'escalate',
  render: (props) => {
    if (props.status?.type === 'running') return <ToolFallback {...props} />;

    const a = asRecord(props.args);
    const r = asRecord(props.result);
    if (!r) return <ToolFallback {...props} />;

    return (
      <ToolSpacing>
        <ProgressTracker
          id="escalate"
          steps={[
            {
              id: 'mode-change',
              label: r.success
                ? `Mode set to ${String(a?.mode ?? 'unknown')}`
                : String(r.message ?? 'Failed'),
              description: a?.reason ? String(a.reason) : undefined,
              status: r.success ? 'completed' : 'failed',
            },
          ]}
        />
      </ToolSpacing>
    );
  },
});

// ─── resolve_interaction ─────────────────────────────────────────────

const ResolveInteractionToolUI = makeAssistantToolUI({
  toolName: 'resolve_interaction',
  render: (props) => {
    if (props.status?.type === 'running') return <ToolFallback {...props} />;

    const a = asRecord(props.args);
    const r = asRecord(props.result);
    if (!r) return <ToolFallback {...props} />;

    return (
      <ToolSpacing>
        <ProgressTracker
          id="interaction-resolve"
          steps={[
            {
              id: 'resolve',
              label: r.success ? 'Interaction resolved' : 'Resolution failed',
              description: a?.summary ? String(a.summary) : undefined,
              status: r.success ? 'completed' : 'failed',
            },
          ]}
        />
      </ToolSpacing>
    );
  },
});

// ─── new_topic ──────────────────────────────────────────────────────

const NewTopicToolUI = makeAssistantToolUI({
  toolName: 'new_topic',
  render: (props) => {
    if (props.status?.type === 'running') return <ToolFallback {...props} />;

    const a = asRecord(props.args);
    const r = asRecord(props.result);
    if (!r) return <ToolFallback {...props} />;

    return (
      <ToolSpacing>
        <ProgressTracker
          id="new-topic"
          steps={[
            {
              id: 'topic',
              label: r.success
                ? 'Topic resolved — next message starts fresh'
                : 'Topic change failed',
              description: a?.nextTopic
                ? String(a.nextTopic)
                : a?.summary
                  ? String(a.summary)
                  : undefined,
              status: r.success ? 'completed' : 'failed',
            },
          ]}
        />
      </ToolSpacing>
    );
  },
});

// ─── agent_handoff ───────────────────────────────────────────────────

const AgentHandoffToolUI = makeAssistantToolUI({
  toolName: 'agent_handoff',
  render: (props) => {
    if (props.status?.type === 'running') return <ToolFallback {...props} />;

    const r = asRecord(props.result);
    if (!r) return <ToolFallback {...props} />;

    return (
      <ToolSpacing>
        <ProgressTracker
          id="agent-handoff"
          steps={[
            {
              id: 'handoff',
              label: r.success ? 'Handed off to agent' : 'Handoff failed',
              status: r.success ? 'completed' : 'failed',
            },
          ]}
        />
      </ToolSpacing>
    );
  },
});

// ─── Registry component ──────────────────────────────────────────────

export function VobaseToolUIs() {
  return (
    <>
      <SearchKBToolUI />
      <RetrieveContextToolUI />
      <GetContactInfoToolUI />
      <GetContactMemoryToolUI />
      <ConsultHumanToolUI />
      <CheckAvailabilityToolUI />
      <BookSlotToolUI />
      <CancelBookingToolUI />
      <RescheduleBookingToolUI />
      <SendReminderToolUI />
      <EscalateToolUI />
      <ResolveInteractionToolUI />
      <NewTopicToolUI />
      <AgentHandoffToolUI />
    </>
  );
}
