import { defineViewable } from '@vobase/core'

import type { ModuleDef } from '~/runtime'
import { jobs } from './jobs'
import { conversations as conversationsTable } from './schema'

// Register the conversations viewable at module-load time so the views
// module sees it on first `views.query`. Scope `object:messaging` matches
// the convention `object:<module>` produced by the saved-view reconciler's
// default `parsePath` for files under `modules/messaging/views/*.view.yaml`.
defineViewable({
  scope: 'object:messaging',
  table: conversationsTable,
  columns: [
    { name: 'id', type: 'text', label: 'ID', filterable: true, sortable: true },
    { name: 'contactId', type: 'text', label: 'Contact', filterable: true, sortable: false },
    {
      name: 'channelInstanceId',
      type: 'text',
      label: 'Channel',
      filterable: true,
      sortable: false,
    },
    { name: 'assignee', type: 'text', label: 'Assignee', filterable: true, sortable: true },
    { name: 'status', type: 'text', label: 'Status', filterable: true, sortable: true },
    { name: 'snoozedUntil', type: 'date', label: 'Snoozed until', filterable: true, sortable: true },
    {
      name: 'lastMessageAt',
      type: 'date',
      label: 'Last activity',
      filterable: true,
      sortable: true,
    },
    { name: 'createdAt', type: 'date', label: 'Created', filterable: true, sortable: true },
    { name: 'updatedAt', type: 'date', label: 'Updated', filterable: true, sortable: true },
  ],
  defaultView: {
    columns: ['contactId', 'channelInstanceId', 'assignee', 'status', 'lastMessageAt'],
    sort: [{ column: 'lastMessageAt', direction: 'desc' }],
  },
})

import {
  type ConversationScheduler,
  createConversationsService,
  installConversationsService,
} from './service/conversations'
import { createMessagesService, installMessagesService } from './service/messages'
import { createNotesService, installNotesService } from './service/notes'
import {
  type ApprovalScheduler,
  createPendingApprovalsService,
  installPendingApprovalsService,
} from './service/pending-approvals'
import { createStaffOpsService, installStaffOpsService } from './service/staff-ops'
import * as web from './web'

export type { ApprovalScheduler, ConversationScheduler }

const messaging: ModuleDef = {
  name: 'messaging',
  requires: ['contacts'],
  web: { routes: web.routes },
  // No static agent tools — concierge-facing tools moved to
  // `modules/agents/tools/concierge/` per the dual-surface tool partition.
  // The concierge wake-config wires them in directly.
  jobs: [...jobs],
  init(ctx) {
    const conversationScheduler = (ctx.jobs as unknown as ConversationScheduler | undefined) ?? null
    installConversationsService(createConversationsService({ db: ctx.db, scheduler: conversationScheduler }))
    installPendingApprovalsService(createPendingApprovalsService({ db: ctx.db }))
    installMessagesService(createMessagesService({ db: ctx.db }))
    installNotesService(createNotesService({ db: ctx.db }))
    installStaffOpsService(createStaffOpsService({ db: ctx.db }))
  },
}

export default messaging
