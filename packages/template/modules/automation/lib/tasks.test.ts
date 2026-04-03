import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import type { ModuleDeps } from './deps';
import { setModuleDeps } from './deps';

// ─── Helpers ─────────────────────────────────────────────────────────

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task_1',
    sessionId: null,
    adapterId: 'whatsapp',
    action: 'send_message',
    input: { to: '+1', text: 'hi' },
    output: null,
    status: 'pending',
    assignedTo: null,
    requiresApproval: true,
    approvedAt: null,
    approvedBy: null,
    domSnapshot: null,
    errorMessage: null,
    requestedBy: 'staff',
    sourceConversationId: null,
    timeoutMinutes: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockDeps(): ModuleDeps {
  const returning = mock(async () => [makeRow()]);
  const set = mock(() => ({ where: mock(() => ({ returning })) }));
  const update = mock(() => ({ set }));
  const values = mock(() => ({ returning: mock(async () => [makeRow()]) }));
  const insert = mock(() => ({ values }));
  const execute = mock(async () => ({ rows: [] }));

  return {
    db: { update, insert, execute } as unknown as ModuleDeps['db'],
    scheduler: {} as ModuleDeps['scheduler'],
    realtime: {
      notify: mock(() => {}),
    } as unknown as ModuleDeps['realtime'],
    auth: {
      verifyApiKey: mock(async () => null),
      createApiKey: mock(async () => null),
      revokeApiKey: mock(async () => false),
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('automation/tasks', () => {
  let deps: ModuleDeps;

  beforeEach(() => {
    deps = createMockDeps();
    setModuleDeps(deps);
  });

  afterEach(() => {
    // Reset module deps
    setModuleDeps(undefined as unknown as ModuleDeps);
  });

  describe('TASK_STATUSES', () => {
    it('does not include "assigned" (removed from state machine)', async () => {
      const { TASK_STATUSES } = await import('./tasks');
      expect(TASK_STATUSES).not.toContain('assigned');
      expect(TASK_STATUSES).toContain('pending');
      expect(TASK_STATUSES).toContain('executing');
      expect(TASK_STATUSES).toContain('completed');
      expect(TASK_STATUSES).toContain('failed');
      expect(TASK_STATUSES).toContain('cancelled');
      expect(TASK_STATUSES).toContain('timeout');
    });
  });

  describe('createTask', () => {
    it('inserts a task with pending status and notifies', async () => {
      const { createTask } = await import('./tasks');

      const task = await createTask({
        adapterId: 'whatsapp',
        action: 'send_message',
        input: { to: '+1', text: 'hello' },
        requestedBy: 'staff',
      });

      expect(task).toBeDefined();
      expect(task.id).toBe('task_1');
      expect(deps.realtime.notify).toHaveBeenCalledWith({
        table: 'automation-tasks',
        action: 'insert',
      });
    });
  });

  describe('completeTask', () => {
    it('only updates tasks in executing state', async () => {
      const { completeTask } = await import('./tasks');

      await completeTask('task_1', { result: 'ok' });

      const updateCall = (deps.db.update as ReturnType<typeof mock>).mock
        .calls[0];
      expect(updateCall).toBeDefined();
    });
  });

  describe('cancelTask', () => {
    it('returns true when task is cancelled', async () => {
      const { cancelTask } = await import('./tasks');

      // Mock returning a row (successful cancel)
      const returning = mock(async () => [{ id: 'task_1' }]);
      const where = mock(() => ({ returning }));
      const set = mock(() => ({ where }));
      (deps.db.update as ReturnType<typeof mock>).mockReturnValue({ set });

      const result = await cancelTask('task_1');
      expect(result).toBe(true);
      expect(deps.realtime.notify).toHaveBeenCalled();
    });

    it('returns false when task is not in cancellable state', async () => {
      const { cancelTask } = await import('./tasks');

      // Mock returning empty (no rows updated)
      const returning = mock(async () => []);
      const where = mock(() => ({ returning }));
      const set = mock(() => ({ where }));
      (deps.db.update as ReturnType<typeof mock>).mockReturnValue({ set });

      const result = await cancelTask('task_1');
      expect(result).toBe(false);
    });
  });

  describe('claimNextTask', () => {
    it('returns null when no tasks available', async () => {
      const { claimNextTask } = await import('./tasks');

      (deps.db as unknown as { execute: ReturnType<typeof mock> }).execute =
        mock(async () => ({ rows: [] }));

      const task = await claimNextTask('user_1', 'session_1');
      expect(task).toBeNull();
    });

    it('returns the claimed task and notifies', async () => {
      const { claimNextTask } = await import('./tasks');
      const row = makeRow({ status: 'executing', sessionId: 'session_1' });

      // Mock execute (atomic claim) returning the claimed ID
      (deps.db as unknown as { execute: ReturnType<typeof mock> }).execute =
        mock(async () => ({ rows: [{ id: 'task_1' }] }));

      // Mock the follow-up select to return the full row
      const limit = mock(async () => [row]);
      const where = mock(() => ({ limit }));
      const from = mock(() => ({ where }));
      const select = mock(() => ({ from }));
      (deps.db as unknown as { select: ReturnType<typeof mock> }).select =
        select;

      const task = await claimNextTask('user_1', 'session_1');
      expect(task).not.toBeNull();
      expect(task?.id).toBe('task_1');
      expect(deps.realtime.notify).toHaveBeenCalledWith({
        table: 'automation-tasks',
        action: 'update',
      });
    });
  });
});
