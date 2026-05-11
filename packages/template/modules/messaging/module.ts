import type { ModuleDef } from '~/runtime'
import { MESSAGING_STAFF_NOTE_TO_WAKE_JOB } from '~/wake/staff-note'
import { messagingAgent } from './agent'
import { messagingVerbs } from './cli'
import { jobs } from './jobs'
import { createAgentMentionsService, installAgentMentionsService } from './service/agent-mentions'
import {
  type ConversationScheduler,
  createConversationsService,
  get as getConversation,
  installConversationsService,
} from './service/conversations'
import { setDriveAttachmentsDb } from './service/drive-attachments'
import { createMessagesService, installMessagesService } from './service/messages'
import {
  buildStaffNoteSingletonKey,
  type ConversationsReader,
  createNotesService,
  installNotesService,
  type NoteTriageScheduler,
  type StaffNoteScheduler,
} from './service/notes'
import {
  type ApprovalScheduler,
  createPendingApprovalsService,
  installPendingApprovalsService,
} from './service/pending-approvals'
import { createReactionsService, installReactionsService } from './service/reactions'
import { createSessionsService, installSessionsService } from './service/sessions'
import { createStaffOpsService, installStaffOpsService } from './service/staff-ops'
import { installStaffReplyTriageScheduler, type StaffReplyTriageScheduler } from './service/staff-reply'
import { convReassignVerb } from './verbs/conv-reassign'
import * as web from './web'

export type { ApprovalScheduler, ConversationScheduler }

const messaging: ModuleDef = {
  name: 'messaging',
  requires: ['contacts'],
  web: { routes: web.routes },
  jobs: [...jobs],
  agent: messagingAgent,
  init(ctx) {
    const conversationScheduler = (ctx.jobs as unknown as ConversationScheduler | undefined) ?? null
    installConversationsService(createConversationsService({ db: ctx.db, scheduler: conversationScheduler }))
    installPendingApprovalsService(createPendingApprovalsService({ db: ctx.db }))
    installMessagesService(createMessagesService({ db: ctx.db }))
    setDriveAttachmentsDb(ctx.db)

    // Agent-mention resolver must be installed BEFORE notes — `addNote`'s
    // post-commit fan-out calls into it.
    installAgentMentionsService(createAgentMentionsService({ db: ctx.db }))

    // Staff-note fan-out scheduler: bridges `addNote` to the queue. Each
    // distinct (conversation, note, mentionedAgentId | 'self') tuple gets a
    // unique singletonKey so retries dedup but distinct peer wakes never
    // merge.
    const staffNoteScheduler: StaffNoteScheduler = {
      enqueueStaffNote: async (opts) => {
        await ctx.jobs.send(
          MESSAGING_STAFF_NOTE_TO_WAKE_JOB,
          {
            organizationId: opts.organizationId,
            conversationId: opts.conversationId,
            noteId: opts.noteId,
            authorUserId: opts.authorUserId,
            mentionedAgentId: opts.mentionedAgentId,
            assigneeAgentId: opts.assigneeAgentId,
            body: opts.body,
          },
          {
            singletonKey: buildStaffNoteSingletonKey({
              conversationId: opts.conversationId,
              noteId: opts.noteId,
              mentionedAgentId: opts.mentionedAgentId,
            }),
          },
        )
      },
    }

    const conversationsReader: ConversationsReader = {
      getAssigneeAgentId: async (conversationId) => {
        const conv = await getConversation(conversationId)
        return conv.assignee.startsWith('agent:') ? conv.assignee.slice('agent:'.length) : null
      },
    }

    // Shared triage scheduler satisfies both NoteTriageScheduler and StaffReplyTriageScheduler.
    const triageScheduler: NoteTriageScheduler & StaffReplyTriageScheduler = {
      publish: async (name, payload) => {
        await ctx.jobs.send(name, payload)
      },
    }

    installNotesService(
      createNotesService({
        db: ctx.db,
        scheduler: staffNoteScheduler,
        conversations: conversationsReader,
        triageScheduler,
      }),
    )
    installStaffReplyTriageScheduler(triageScheduler)
    installStaffOpsService(createStaffOpsService({ db: ctx.db }))
    installSessionsService(createSessionsService({ db: ctx.db }))
    installReactionsService(createReactionsService({ db: ctx.db }))
    ctx.cli.registerAll([...messagingVerbs, convReassignVerb])
  },
}

export default messaging
