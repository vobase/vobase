import type { ModuleDef } from '~/runtime'
import { MESSAGING_SUPERVISOR_TO_WAKE_JOB } from '~/wake/supervisor'
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
import { createMessagesService, installMessagesService } from './service/messages'
import {
  buildSupervisorSingletonKey,
  type ConversationsReader,
  createNotesService,
  installNotesService,
  type SupervisorScheduler,
} from './service/notes'
import {
  type ApprovalScheduler,
  createPendingApprovalsService,
  installPendingApprovalsService,
} from './service/pending-approvals'
import { createStaffOpsService, installStaffOpsService } from './service/staff-ops'
import { convAskStaffVerb } from './verbs/conv-ask-staff'
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

    // Agent-mention resolver must be installed BEFORE notes — `addNote`'s
    // post-commit fan-out calls into it.
    installAgentMentionsService(createAgentMentionsService({ db: ctx.db }))

    // Supervisor fan-out scheduler: bridges `addNote` to the queue. Each
    // distinct (conversation, note, mentionedAgentId | 'self') tuple gets a
    // unique singletonKey so retries dedup but distinct peer wakes never
    // merge.
    const supervisorScheduler: SupervisorScheduler = {
      enqueueSupervisor: async (opts) => {
        await ctx.jobs.send(
          MESSAGING_SUPERVISOR_TO_WAKE_JOB,
          {
            organizationId: opts.organizationId,
            conversationId: opts.conversationId,
            noteId: opts.noteId,
            authorUserId: opts.authorUserId,
            mentionedAgentId: opts.mentionedAgentId,
            assigneeAgentId: opts.assigneeAgentId,
          },
          {
            singletonKey: buildSupervisorSingletonKey({
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

    installNotesService(
      createNotesService({
        db: ctx.db,
        scheduler: supervisorScheduler,
        conversations: conversationsReader,
      }),
    )
    installStaffOpsService(createStaffOpsService({ db: ctx.db }))
    ctx.cli.registerAll([...messagingVerbs, convReassignVerb, convAskStaffVerb])
  },
}

export default messaging
