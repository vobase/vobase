/**
 * VobaseMemoryStorage — Custom Mastra MemoryStorage that maps onto the
 * existing interactions schema (interactions, messages, contacts tables).
 *
 * Threads → interactions, Messages → messages, Resources → contacts.
 * Mastra's own PostgresStore-managed memory tables become unnecessary.
 */
import type {
  MastraDBMessage,
  MastraMessageContentV2,
} from '@mastra/core/agent';
import type { StorageThreadType } from '@mastra/core/memory';
import type {
  CreateObservationalMemoryInput,
  CreateReflectionGenerationInput,
  ObservationalMemoryRecord,
  StorageListMessagesByResourceIdInput,
  StorageListMessagesInput,
  StorageListMessagesOutput,
  StorageListThreadsInput,
  StorageListThreadsOutput,
  StorageResourceType,
  SwapBufferedReflectionToActiveInput,
  SwapBufferedToActiveInput,
  SwapBufferedToActiveResult,
  UpdateActiveObservationsInput,
  UpdateBufferedObservationsInput,
  UpdateBufferedReflectionInput,
} from '@mastra/core/storage';
import { MemoryStorage } from '@mastra/core/storage';
import type { VobaseDb } from '@vobase/core';
import { and, asc, desc, eq, gt, gte, inArray, lt, lte } from 'drizzle-orm';

import { contacts, interactions, messages } from '../../modules/ai/schema';

// ─── Role Mapping ──────────────────────────────────────────────────
// Mastra role → Vobase senderType + messageType

function mastraRoleToVobase(role: MastraDBMessage['role']): {
  senderType: string;
  messageType: string;
} {
  switch (role) {
    case 'user':
      return { senderType: 'contact', messageType: 'incoming' };
    case 'assistant':
      return { senderType: 'agent', messageType: 'outgoing' };
    case 'system':
      return { senderType: 'system', messageType: 'activity' };
    default:
      return { senderType: 'agent', messageType: 'activity' };
  }
}

function vobaseToMastraRole(senderType: string): MastraDBMessage['role'] {
  switch (senderType) {
    case 'contact':
      return 'user';
    case 'agent':
      return 'assistant';
    case 'system':
      return 'system';
    default:
      return 'assistant';
  }
}

// ─── Text Extraction ───────────────────────────────────────────────

function extractPlainText(content: MastraMessageContentV2): string {
  if (content.content && typeof content.content === 'string') {
    return content.content;
  }
  if (!content.parts) return '';
  return content.parts
    .map((p) => {
      if ('text' in p && typeof p.text === 'string') return p.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

// ─── Row → Mastra Conversions ──────────────────────────────────────

type MessageRow = typeof messages.$inferSelect;
type InteractionRow = typeof interactions.$inferSelect;
type ContactRow = typeof contacts.$inferSelect;

function rowToMastraMessage(row: MessageRow): MastraDBMessage {
  const mastraContent = row.mastraContent as MastraMessageContentV2 | null;
  return {
    id: row.id,
    role: vobaseToMastraRole(row.senderType),
    content: mastraContent ?? {
      format: 2,
      parts: [{ type: 'text' as const, text: row.content }],
    },
    createdAt: row.createdAt,
    threadId: row.interactionId,
    resourceId: row.senderId,
    type: row.contentType,
  };
}

function rowToStorageThread(row: InteractionRow): StorageThreadType {
  return {
    id: row.id,
    title: row.title ?? undefined,
    resourceId: `contact:${row.contactId}`,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

function rowToStorageResource(row: ContactRow): StorageResourceType {
  return {
    id: `contact:${row.id}`,
    workingMemory: row.workingMemory ?? undefined,
    metadata: (row.resourceMetadata as Record<string, unknown>) ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Strip "contact:" prefix ───────────────────────────────────────

function stripContactPrefix(resourceId: string): string {
  return resourceId.startsWith('contact:')
    ? resourceId.slice('contact:'.length)
    : resourceId;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VobaseMemoryStorage
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class VobaseMemoryStorage extends MemoryStorage {
  override readonly supportsObservationalMemory = true;
  private db: VobaseDb;
  private omDelegate: MemoryStorage;

  constructor(db: VobaseDb, omDelegate: MemoryStorage) {
    super();
    this.db = db;
    this.omDelegate = omDelegate;
  }

  override async init(): Promise<void> {
    // Tables managed by Drizzle schema — no-op
  }

  override async dangerouslyClearAll(): Promise<void> {
    // Not implementing — too dangerous for production tables
    throw new Error(
      'dangerouslyClearAll is not supported on VobaseMemoryStorage',
    );
  }

  // ─── Thread Methods (interactions table) ──────────────────────

  override async getThreadById({
    threadId,
  }: {
    threadId: string;
  }): Promise<StorageThreadType | null> {
    console.log('[VobaseMemoryStorage.getThreadById]', threadId);
    const rows = await this.db
      .select()
      .from(interactions)
      .where(eq(interactions.id, threadId))
      .limit(1);
    return rows[0] ? rowToStorageThread(rows[0]) : null;
  }

  override async saveThread({
    thread,
  }: {
    thread: StorageThreadType;
  }): Promise<StorageThreadType> {
    const contactId = stripContactPrefix(thread.resourceId);
    // Upsert — if the interaction already exists, update it
    const rows = await this.db
      .insert(interactions)
      .values({
        id: thread.id,
        contactId,
        title: thread.title ?? null,
        metadata: thread.metadata ?? {},
        // Required fields with defaults for Mastra-created threads
        channelRoutingId:
          (thread.metadata?.channelRoutingId as string) ?? 'web',
        agentId: (thread.metadata?.agentId as string) ?? 'default',
        channelInstanceId:
          (thread.metadata?.channelInstanceId as string) ?? 'web',
      })
      .onConflictDoUpdate({
        target: interactions.id,
        set: {
          title: thread.title ?? null,
          metadata: thread.metadata ?? {},
        },
      })
      .returning();
    return rowToStorageThread(rows[0]!);
  }

  override async updateThread({
    id,
    title,
    metadata,
  }: {
    id: string;
    title: string;
    metadata: Record<string, unknown>;
  }): Promise<StorageThreadType> {
    const rows = await this.db
      .update(interactions)
      .set({ title, metadata })
      .where(eq(interactions.id, id))
      .returning();
    if (!rows[0]) throw new Error(`Thread ${id} not found`);
    return rowToStorageThread(rows[0]);
  }

  override async deleteThread({
    threadId,
  }: {
    threadId: string;
  }): Promise<void> {
    // Soft delete — set status to resolved rather than destroying data
    await this.db
      .update(interactions)
      .set({ status: 'resolved' })
      .where(eq(interactions.id, threadId));
  }

  override async listThreads(
    args: StorageListThreadsInput,
  ): Promise<StorageListThreadsOutput> {
    const page = args.page ?? 0;
    const perPage =
      args.perPage === false ? Number.MAX_SAFE_INTEGER : (args.perPage ?? 100);
    const direction = args.orderBy?.direction ?? 'DESC';
    const field = args.orderBy?.field ?? 'createdAt';

    const conditions = [];
    if (args.filter?.resourceId) {
      const contactId = stripContactPrefix(args.filter.resourceId);
      conditions.push(eq(interactions.contactId, contactId));
    }

    const orderCol =
      field === 'updatedAt' ? interactions.updatedAt : interactions.createdAt;
    const orderFn = direction === 'ASC' ? asc : desc;

    const rows = await this.db
      .select()
      .from(interactions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(orderFn(orderCol))
      .limit(perPage + 1) // fetch one extra to check hasMore
      .offset(page * perPage);

    const hasMore = rows.length > perPage;
    const threads = (hasMore ? rows.slice(0, perPage) : rows).map(
      rowToStorageThread,
    );

    return {
      threads,
      total: threads.length, // approximate — exact count requires separate query
      page,
      perPage: args.perPage === false ? false : perPage,
      hasMore,
    };
  }

  // ─── Message Methods (messages table) ──────────────────────────

  override async saveMessages({
    messages: msgs,
  }: {
    messages: MastraDBMessage[];
  }): Promise<{ messages: MastraDBMessage[] }> {
    if (msgs.length === 0) return { messages: [] };

    console.log(
      '[VobaseMemoryStorage.saveMessages]',
      msgs.length,
      'messages, threadIds:',
      [...new Set(msgs.map((m) => m.threadId))],
      'roles:',
      msgs.map((m) => m.role),
    );

    const values = msgs.map((msg) => {
      const { senderType, messageType } = mastraRoleToVobase(msg.role);
      const plainText = extractPlainText(msg.content);
      return {
        id: msg.id,
        interactionId: msg.threadId!,
        messageType,
        contentType: 'text' as const,
        content: plainText || '(empty)',
        contentData: {},
        mastraContent: msg.content as unknown as Record<string, unknown>,
        senderId: msg.resourceId ?? 'system',
        senderType,
      };
    });

    // ON CONFLICT DO NOTHING to handle duplicate message IDs
    try {
      await this.db
        .insert(messages)
        .values(values)
        .onConflictDoNothing({ target: messages.id });
      console.log(
        '[VobaseMemoryStorage.saveMessages] INSERT OK, ids:',
        values.map((v) => v.id),
      );
    } catch (err) {
      console.error('[VobaseMemoryStorage.saveMessages] INSERT FAILED:', err);
      throw err;
    }

    return { messages: msgs };
  }

  override async listMessages(
    args: StorageListMessagesInput,
  ): Promise<StorageListMessagesOutput> {
    const threadIds = Array.isArray(args.threadId)
      ? args.threadId
      : [args.threadId];
    const page = args.page ?? 0;
    const perPage =
      args.perPage === false ? Number.MAX_SAFE_INTEGER : (args.perPage ?? 40);
    const direction = args.orderBy?.direction ?? 'DESC';

    const conditions = [inArray(messages.interactionId, threadIds)];

    if (args.filter?.dateRange) {
      const { start, end, startExclusive, endExclusive } =
        args.filter.dateRange;
      if (start) {
        conditions.push(
          startExclusive
            ? gt(messages.createdAt, start)
            : gte(messages.createdAt, start),
        );
      }
      if (end) {
        conditions.push(
          endExclusive
            ? lt(messages.createdAt, end)
            : lte(messages.createdAt, end),
        );
      }
    }

    const orderFn = direction === 'ASC' ? asc : desc;

    const rows = await this.db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(orderFn(messages.createdAt))
      .limit(perPage + 1)
      .offset(page * perPage);

    const hasMore = rows.length > perPage;
    const result = (hasMore ? rows.slice(0, perPage) : rows).map(
      rowToMastraMessage,
    );

    return {
      messages: result,
      total: result.length,
      page,
      perPage: args.perPage === false ? false : perPage,
      hasMore,
    };
  }

  override async listMessagesById({
    messageIds,
  }: {
    messageIds: string[];
  }): Promise<{ messages: MastraDBMessage[] }> {
    if (messageIds.length === 0) return { messages: [] };
    const rows = await this.db
      .select()
      .from(messages)
      .where(inArray(messages.id, messageIds));
    return { messages: rows.map(rowToMastraMessage) };
  }

  override async updateMessages({
    messages: updates,
  }: {
    messages: (Partial<Omit<MastraDBMessage, 'createdAt'>> & {
      id: string;
      content?: {
        metadata?: MastraMessageContentV2['metadata'];
        content?: MastraMessageContentV2['content'];
      };
    })[];
  }): Promise<MastraDBMessage[]> {
    const results: MastraDBMessage[] = [];
    for (const update of updates) {
      const set: Record<string, unknown> = {};
      if (update.content?.content) {
        set.mastraContent = update.content as unknown as Record<
          string,
          unknown
        >;
      }
      if (Object.keys(set).length > 0) {
        await this.db
          .update(messages)
          .set(set)
          .where(eq(messages.id, update.id));
      }
      // Fetch the updated row
      const rows = await this.db
        .select()
        .from(messages)
        .where(eq(messages.id, update.id))
        .limit(1);
      if (rows[0]) results.push(rowToMastraMessage(rows[0]));
    }
    return results;
  }

  override async deleteMessages(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    await this.db.delete(messages).where(inArray(messages.id, messageIds));
  }

  // ─── Resource Methods (contacts table) ─────────────────────────

  override async getResourceById({
    resourceId,
  }: {
    resourceId: string;
  }): Promise<StorageResourceType | null> {
    const contactId = stripContactPrefix(resourceId);
    const rows = await this.db
      .select()
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);
    return rows[0] ? rowToStorageResource(rows[0]) : null;
  }

  override async saveResource({
    resource,
  }: {
    resource: StorageResourceType;
  }): Promise<StorageResourceType> {
    const contactId = stripContactPrefix(resource.id);
    const rows = await this.db
      .update(contacts)
      .set({
        workingMemory: resource.workingMemory ?? null,
        resourceMetadata:
          (resource.metadata as Record<string, unknown>) ?? null,
      })
      .where(eq(contacts.id, contactId))
      .returning();
    if (!rows[0]) throw new Error(`Contact ${contactId} not found`);
    return rowToStorageResource(rows[0]);
  }

  override async updateResource({
    resourceId,
    workingMemory,
    metadata,
  }: {
    resourceId: string;
    workingMemory?: string;
    metadata?: Record<string, unknown>;
  }): Promise<StorageResourceType> {
    const contactId = stripContactPrefix(resourceId);
    const set: Record<string, unknown> = {};
    if (workingMemory !== undefined) set.workingMemory = workingMemory;
    if (metadata !== undefined) set.resourceMetadata = metadata;

    if (Object.keys(set).length > 0) {
      await this.db.update(contacts).set(set).where(eq(contacts.id, contactId));
    }

    const rows = await this.db
      .select()
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);
    if (!rows[0]) throw new Error(`Contact ${contactId} not found`);
    return rowToStorageResource(rows[0]);
  }

  // ─── Observational Memory Delegation ──────────────────────────
  // All OM methods delegate to PostgresStore's MemoryPG instance,
  // which manages its own mastra_observational_memory table.

  override async listMessagesByResourceId(
    args: StorageListMessagesByResourceIdInput,
  ): Promise<StorageListMessagesOutput> {
    return this.omDelegate.listMessagesByResourceId(args);
  }

  override async getObservationalMemory(
    threadId: string | null,
    resourceId: string,
  ): Promise<ObservationalMemoryRecord | null> {
    return this.omDelegate.getObservationalMemory(threadId, resourceId);
  }

  override async getObservationalMemoryHistory(
    threadId: string | null,
    resourceId: string,
    limit?: number,
  ): Promise<ObservationalMemoryRecord[]> {
    return this.omDelegate.getObservationalMemoryHistory(
      threadId,
      resourceId,
      limit,
    );
  }

  override async initializeObservationalMemory(
    input: CreateObservationalMemoryInput,
  ): Promise<ObservationalMemoryRecord> {
    return this.omDelegate.initializeObservationalMemory(input);
  }

  override async updateActiveObservations(
    input: UpdateActiveObservationsInput,
  ): Promise<void> {
    return this.omDelegate.updateActiveObservations(input);
  }

  override async updateBufferedObservations(
    input: UpdateBufferedObservationsInput,
  ): Promise<void> {
    return this.omDelegate.updateBufferedObservations(input);
  }

  override async swapBufferedToActive(
    input: SwapBufferedToActiveInput,
  ): Promise<SwapBufferedToActiveResult> {
    return this.omDelegate.swapBufferedToActive(input);
  }

  override async createReflectionGeneration(
    input: CreateReflectionGenerationInput,
  ): Promise<ObservationalMemoryRecord> {
    return this.omDelegate.createReflectionGeneration(input);
  }

  override async updateBufferedReflection(
    input: UpdateBufferedReflectionInput,
  ): Promise<void> {
    return this.omDelegate.updateBufferedReflection(input);
  }

  override async swapBufferedReflectionToActive(
    input: SwapBufferedReflectionToActiveInput,
  ): Promise<ObservationalMemoryRecord> {
    return this.omDelegate.swapBufferedReflectionToActive(input);
  }

  override async setReflectingFlag(
    id: string,
    isReflecting: boolean,
  ): Promise<void> {
    return this.omDelegate.setReflectingFlag(id, isReflecting);
  }

  override async setObservingFlag(
    id: string,
    isObserving: boolean,
  ): Promise<void> {
    return this.omDelegate.setObservingFlag(id, isObserving);
  }

  override async setBufferingObservationFlag(
    id: string,
    isBuffering: boolean,
    lastBufferedAtTokens?: number,
  ): Promise<void> {
    return this.omDelegate.setBufferingObservationFlag(
      id,
      isBuffering,
      lastBufferedAtTokens,
    );
  }

  override async setBufferingReflectionFlag(
    id: string,
    isBuffering: boolean,
  ): Promise<void> {
    return this.omDelegate.setBufferingReflectionFlag(id, isBuffering);
  }

  override async insertObservationalMemoryRecord(
    record: ObservationalMemoryRecord,
  ): Promise<void> {
    return this.omDelegate.insertObservationalMemoryRecord(record);
  }

  override async clearObservationalMemory(
    threadId: string | null,
    resourceId: string,
  ): Promise<void> {
    return this.omDelegate.clearObservationalMemory(threadId, resourceId);
  }

  override async setPendingMessageTokens(
    id: string,
    tokenCount: number,
  ): Promise<void> {
    return this.omDelegate.setPendingMessageTokens(id, tokenCount);
  }
}
