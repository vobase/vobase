/**
 * Re-export bridge — types have moved to their owning module schemas.
 * This file exists only for backward compatibility during migration.
 * TODO: delete once all importers point to @modules/<name>/schema.
 */

// agents
export type {
  AgentDefinition,
  AgentMemoryAntiLessons,
  AgentScore,
  LearningAction,
  LearningProposal,
  LearningScope,
  LearningStatus,
  ModerationCategory,
} from '@modules/agents/schema'
// contacts
export type { Contact, StaffBinding } from '@modules/contacts/schema'
// drive
export type { DriveFile, DriveKind, DriveProcessingStatus, DriveScopeName, DriveSource } from '@modules/drive/schema'
// messaging
export type {
  ApprovalStatus,
  Conversation,
  ConversationStatus,
  InternalNote,
  InternalNoteAuthorType,
  Message,
  MessageKind,
  MessageRole,
  PendingApproval,
} from '@modules/messaging/schema'
// harness (moved to @vobase/core)
export type { ConversationEvent } from '@vobase/core'
