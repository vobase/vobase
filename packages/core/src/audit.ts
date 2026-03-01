import { recordAudits, type VobaseDb } from './db';

function valuesAreEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (
    typeof left === 'object' &&
    left !== null &&
    typeof right === 'object' &&
    right !== null
  ) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  return false;
}

export function trackChanges(
  db: VobaseDb,
  tableName: string,
  recordId: string,
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
  userId?: string,
): void {
  if (oldData === null && newData === null) {
    return;
  }

  let oldDiff: Record<string, unknown> | null = null;
  let newDiff: Record<string, unknown> | null = null;

  if (oldData === null) {
    newDiff = newData;
  } else if (newData === null) {
    oldDiff = oldData;
  } else {
    oldDiff = {};
    newDiff = {};

    const keys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
    for (const key of keys) {
      const previousValue = oldData[key];
      const nextValue = newData[key];

      if (!valuesAreEqual(previousValue, nextValue)) {
        oldDiff[key] = previousValue;
        newDiff[key] = nextValue;
      }
    }

    if (Object.keys(oldDiff).length === 0) {
      return;
    }
  }

  db.insert(recordAudits)
    .values({
      tableName,
      recordId,
      oldData: oldDiff === null ? null : JSON.stringify(oldDiff),
      newData: newDiff === null ? null : JSON.stringify(newDiff),
      changedBy: userId ?? null,
    })
    .run();
}
