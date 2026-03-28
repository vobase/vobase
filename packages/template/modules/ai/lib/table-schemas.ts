import { col } from '@/lib/table-schema';

// ─── Contacts ────────────────────────────────────────────────────────

const CONTACT_ROLES = ['customer', 'lead', 'staff'] as const;

export const contactsTableSchema = {
  id: col.string().label('ID').display('code').notFilterable().hidden(),
  name: col.string().label('Name').filterable('input').sortable(),
  phone: col.string().label('Phone').notFilterable(),
  email: col.string().label('Email').notFilterable(),
  role: col
    .enum(CONTACT_ROLES)
    .label('Role')
    .display('badge', {
      colorMap: {
        staff: '#3b82f6',
        lead: '#f59e0b',
        customer: '#6b7280',
      },
    })
    .filterable('checkbox')
    .defaultOpen()
    .sortable(),
  createdAt: col
    .timestamp()
    .label('Created')
    .sortable()
    .filterable('timerange')
    .commandDisabled(),
};

// ─── Conversations ────────────────────────────────────────────────────

const SESSION_STATUSES = ['active', 'completed', 'failed', 'paused'] as const;

export const conversationsTableSchema = {
  id: col.string().label('ID').display('code').notFilterable().hidden(),
  status: col
    .enum(SESSION_STATUSES)
    .label('Status')
    .display('badge', {
      colorMap: {
        active: '#3b82f6',
        completed: '#22c55e',
        failed: '#ef4444',
        paused: '#6b7280',
      },
    })
    .filterable('checkbox')
    .defaultOpen()
    .sortable(),
  agentId: col
    .enum(['booking'] as const)
    .label('AI Agent')
    .display('badge', {
      colorMap: { booking: '#8b5cf6' },
    })
    .filterable('checkbox')
    .sortable(),
  channelInstanceId: col.string().label('Channel').notFilterable(),
  contactId: col.string().label('Contact').notFilterable().hidden(),
  startedAt: col
    .timestamp()
    .label('Started')
    .sortable()
    .filterable('timerange')
    .commandDisabled(),
  endedAt: col.timestamp().label('Ended').notFilterable().hidden().optional(),
};
