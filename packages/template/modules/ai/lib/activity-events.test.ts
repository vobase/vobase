import { describe, expect, it, mock } from 'bun:test';

import { emitActivityEvent } from './activity-events';

// Mock database and realtime
function createMockDb(options?: { shouldFail?: boolean }) {
  const insertValues = mock(() => ({
    returning: mock(async () => [{ id: 'evt_test123' }]),
  }));

  const insertFn = mock(() => ({
    values: insertValues,
  }));

  if (options?.shouldFail) {
    insertValues.mockImplementation(() => ({
      returning: mock(async () => {
        throw new Error('DB insert failed');
      }),
    }));
  }

  return {
    insert: insertFn,
    _insertValues: insertValues,
  } as unknown as import('@vobase/core').VobaseDb;
}

function createMockRealtime() {
  return {
    notify: mock(async () => {}),
    subscribe: mock(() => () => {}),
    shutdown: mock(async () => {}),
  } as unknown as import('@vobase/core').RealtimeService;
}

describe('emitActivityEvent', () => {
  it('inserts event and notifies for fire-and-forget (null resolutionStatus)', async () => {
    const db = createMockDb();
    const realtime = createMockRealtime();

    await emitActivityEvent(db, realtime, {
      type: 'session.created',
      source: 'system',
      conversationId: 'sess_123',
    });

    expect(db.insert).toHaveBeenCalled();
    expect(realtime.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        table: 'conversations-activity',
        action: 'insert',
      }),
    );
  });

  it('does not throw for fire-and-forget when DB fails', async () => {
    const db = createMockDb({ shouldFail: true });
    const realtime = createMockRealtime();

    // Should not throw
    await emitActivityEvent(db, realtime, {
      type: 'session.created',
      source: 'system',
    });
  });

  it('inserts event with returning for transactional (non-null resolutionStatus)', async () => {
    const db = createMockDb();
    const realtime = createMockRealtime();

    await emitActivityEvent(db, realtime, {
      type: 'escalation.created',
      source: 'agent',
      resolutionStatus: 'pending',
    });

    expect(db.insert).toHaveBeenCalled();
    expect(realtime.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        table: 'conversations-activity',
        id: 'evt_test123',
        action: 'insert',
      }),
      undefined,
    );
  });

  it('throws for transactional when DB fails', async () => {
    const db = createMockDb({ shouldFail: true });
    const realtime = createMockRealtime();

    await expect(
      emitActivityEvent(db, realtime, {
        type: 'escalation.created',
        source: 'agent',
        resolutionStatus: 'pending',
      }),
    ).rejects.toThrow('DB insert failed');
  });

  it('uses tx when provided for transactional events', async () => {
    const db = createMockDb();
    const tx = createMockDb();
    const realtime = createMockRealtime();

    await emitActivityEvent(
      db,
      realtime,
      {
        type: 'guardrail.block',
        source: 'system',
        resolutionStatus: 'pending',
      },
      tx,
    );

    // Should use tx, not db
    expect(tx.insert).toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(realtime.notify).toHaveBeenCalledWith(
      expect.objectContaining({ table: 'conversations-activity' }),
      tx,
    );
  });
});
