import { beforeEach, describe, expect, it } from 'bun:test';
import type { MemoryStorage } from '@mastra/core/storage';
import type { VobaseDb } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { createTestDb } from '../../lib/test-helpers';
import {
  channelInstances,
  channelRoutings,
  contacts,
  conversations,
  messages,
} from '../../modules/ai/schema';
import { VobaseMemoryStorage } from './vobase-memory';

// Minimal no-op OM delegate for tests (OM methods are tested via integration, not unit)
const noopOmDelegate = {} as MemoryStorage;

let db: VobaseDb;
let storage: VobaseMemoryStorage;
let testContactId: string;
let testConversationId: string;

async function seedScaffold() {
  // Insert required FK chain: contact → channelInstance → channelRouting → conversation
  const [contact] = await db
    .insert(contacts)
    .values({ name: 'Test Contact', phone: '+6591234567', role: 'customer' })
    .returning();
  testContactId = contact!.id;

  const [instance] = await db
    .insert(channelInstances)
    .values({ type: 'web', label: 'Web Chat', source: 'env' })
    .returning();

  const [routing] = await db
    .insert(channelRoutings)
    .values({
      name: 'Default',
      channelInstanceId: instance!.id,
      agentId: 'booking-agent',
    })
    .returning();

  const [conv] = await db
    .insert(conversations)
    .values({
      channelRoutingId: routing!.id,
      contactId: testContactId,
      agentId: 'booking-agent',
      channelInstanceId: instance!.id,
      title: 'Initial title',
    })
    .returning();
  testConversationId = conv!.id;
}

describe('VobaseMemoryStorage', () => {
  beforeEach(async () => {
    const result = await createTestDb();
    db = result.db;
    storage = new VobaseMemoryStorage(db, noopOmDelegate);
    await seedScaffold();
  });

  // ─── Thread CRUD ──────────────────────────────────────────────

  describe('threads (conversations)', () => {
    it('getThreadById returns mapped StorageThreadType', async () => {
      const thread = await storage.getThreadById({
        threadId: testConversationId,
      });
      expect(thread).not.toBeNull();
      expect(thread!.id).toBe(testConversationId);
      expect(thread!.resourceId).toBe(`contact:${testContactId}`);
      expect(thread!.title).toBe('Initial title');
      expect(thread!.createdAt).toBeInstanceOf(Date);
    });

    it('getThreadById returns null for missing thread', async () => {
      const thread = await storage.getThreadById({ threadId: 'nonexistent' });
      expect(thread).toBeNull();
    });

    it('updateThread updates title and metadata', async () => {
      const updated = await storage.updateThread({
        id: testConversationId,
        title: 'Updated title',
        metadata: { foo: 'bar' },
      });
      expect(updated.title).toBe('Updated title');
      expect(updated.metadata).toEqual({ foo: 'bar' });
    });

    it('deleteThread soft-deletes by setting status to completed', async () => {
      await storage.deleteThread({ threadId: testConversationId });
      const rows = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, testConversationId));
      expect(rows[0]!.status).toBe('completed');
    });

    it('listThreads filters by resourceId', async () => {
      const result = await storage.listThreads({
        filter: { resourceId: `contact:${testContactId}` },
      });
      expect(result.threads.length).toBe(1);
      expect(result.threads[0]!.id).toBe(testConversationId);
    });

    it('listThreads returns empty for unknown resourceId', async () => {
      const result = await storage.listThreads({
        filter: { resourceId: 'contact:unknown' },
      });
      expect(result.threads.length).toBe(0);
    });
  });

  // ─── Message CRUD ─────────────────────────────────────────────

  describe('messages', () => {
    it('saveMessages persists with mastraContent and plain text', async () => {
      const result = await storage.saveMessages({
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: {
              format: 2,
              parts: [{ type: 'text', text: 'Hello there' }],
            },
            createdAt: new Date(),
            threadId: testConversationId,
            resourceId: testContactId,
          },
          {
            id: 'msg-2',
            role: 'assistant',
            content: {
              format: 2,
              parts: [{ type: 'text', text: 'Hi! How can I help?' }],
            },
            createdAt: new Date(),
            threadId: testConversationId,
            resourceId: 'booking-agent',
          },
        ],
      });
      expect(result.messages).toHaveLength(2);

      // Verify the raw rows
      const rows = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, testConversationId));
      expect(rows).toHaveLength(2);

      const userMsg = rows.find((r) => r.id === 'msg-1')!;
      expect(userMsg.senderType).toBe('contact');
      expect(userMsg.messageType).toBe('incoming');
      expect(userMsg.content).toBe('Hello there');
      expect(userMsg.mastraContent).toEqual({
        format: 2,
        parts: [{ type: 'text', text: 'Hello there' }],
      });

      const agentMsg = rows.find((r) => r.id === 'msg-2')!;
      expect(agentMsg.senderType).toBe('agent');
      expect(agentMsg.messageType).toBe('outgoing');
    });

    it('saveMessages handles duplicates gracefully', async () => {
      const msg = {
        id: 'msg-dup',
        role: 'user' as const,
        content: {
          format: 2 as const,
          parts: [{ type: 'text' as const, text: 'First' }],
        },
        createdAt: new Date(),
        threadId: testConversationId,
        resourceId: testContactId,
      };
      await storage.saveMessages({ messages: [msg] });
      // Second save should not throw
      await storage.saveMessages({ messages: [msg] });

      const rows = await db
        .select()
        .from(messages)
        .where(eq(messages.id, 'msg-dup'));
      expect(rows).toHaveLength(1);
    });

    it('listMessages returns MastraDBMessage format', async () => {
      await storage.saveMessages({
        messages: [
          {
            id: 'msg-list-1',
            role: 'user',
            content: {
              format: 2,
              parts: [{ type: 'text', text: 'Question' }],
            },
            createdAt: new Date(),
            threadId: testConversationId,
            resourceId: testContactId,
          },
        ],
      });

      const result = await storage.listMessages({
        threadId: testConversationId,
      });
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]!.role).toBe('user');
      expect(result.messages[0]!.content.format).toBe(2);
      expect(result.messages[0]!.threadId).toBe(testConversationId);
    });

    it('listMessagesById fetches by IDs', async () => {
      await storage.saveMessages({
        messages: [
          {
            id: 'msg-by-id',
            role: 'assistant',
            content: {
              format: 2,
              parts: [{ type: 'text', text: 'Answer' }],
            },
            createdAt: new Date(),
            threadId: testConversationId,
            resourceId: 'booking-agent',
          },
        ],
      });

      const result = await storage.listMessagesById({
        messageIds: ['msg-by-id'],
      });
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]!.id).toBe('msg-by-id');
    });

    it('deleteMessages removes rows', async () => {
      await storage.saveMessages({
        messages: [
          {
            id: 'msg-del',
            role: 'user',
            content: {
              format: 2,
              parts: [{ type: 'text', text: 'Delete me' }],
            },
            createdAt: new Date(),
            threadId: testConversationId,
            resourceId: testContactId,
          },
        ],
      });
      await storage.deleteMessages(['msg-del']);
      const result = await storage.listMessagesById({
        messageIds: ['msg-del'],
      });
      expect(result.messages).toHaveLength(0);
    });
  });

  // ─── Resource (contacts) ──────────────────────────────────────

  describe('resources (contacts)', () => {
    it('getResourceById returns mapped StorageResourceType', async () => {
      const resource = await storage.getResourceById({
        resourceId: `contact:${testContactId}`,
      });
      expect(resource).not.toBeNull();
      expect(resource!.id).toBe(`contact:${testContactId}`);
      expect(resource!.createdAt).toBeInstanceOf(Date);
    });

    it('saveResource updates working memory on contact', async () => {
      const resource = await storage.saveResource({
        resource: {
          id: `contact:${testContactId}`,
          workingMemory: '<working_memory>Test data</working_memory>',
          metadata: { key: 'value' },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      expect(resource.workingMemory).toBe(
        '<working_memory>Test data</working_memory>',
      );
      expect(resource.metadata).toEqual({ key: 'value' });

      // Verify persisted
      const rows = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, testContactId));
      expect(rows[0]!.workingMemory).toBe(
        '<working_memory>Test data</working_memory>',
      );
      expect(rows[0]!.resourceMetadata).toEqual({ key: 'value' });
    });

    it('updateResource updates specific fields', async () => {
      const resource = await storage.updateResource({
        resourceId: `contact:${testContactId}`,
        workingMemory: 'Updated memory',
      });
      expect(resource.workingMemory).toBe('Updated memory');
    });

    it('getResourceById returns null for unknown contact', async () => {
      const resource = await storage.getResourceById({
        resourceId: 'contact:nonexistent',
      });
      expect(resource).toBeNull();
    });
  });

  // ─── Messages without mastraContent (legacy) ─────────────────

  describe('legacy message handling', () => {
    it('listMessages synthesizes MastraMessageContentV2 for rows without mastraContent', async () => {
      // Insert a raw message without mastraContent (like existing data)
      await db.insert(messages).values({
        id: 'legacy-msg',
        conversationId: testConversationId,
        messageType: 'incoming',
        contentType: 'text',
        content: 'Legacy text message',
        senderId: testContactId,
        senderType: 'contact',
      });

      const result = await storage.listMessages({
        threadId: testConversationId,
      });
      const msg = result.messages.find((m) => m.id === 'legacy-msg')!;
      expect(msg.role).toBe('user');
      expect(msg.content.format).toBe(2);
      expect(msg.content.parts).toEqual([
        { type: 'text', text: 'Legacy text message' },
      ]);
    });
  });
});
