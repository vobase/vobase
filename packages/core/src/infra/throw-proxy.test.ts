import { describe, expect, test } from 'bun:test';

import { createThrowProxy } from './throw-proxy';

interface FakeService {
  doSomething(): void;
  value: string;
}

describe('createThrowProxy', () => {
  test('throws on property access with service name in message', () => {
    const proxy = createThrowProxy<FakeService>('storage');
    expect(() => proxy.value).toThrow('storage is not configured');
  });

  test('throws on method call with service name in message', () => {
    const proxy = createThrowProxy<FakeService>('notify');
    expect(() => proxy.doSomething()).toThrow('notify is not configured');
  });

  test('error message includes configuration hint', () => {
    const proxy = createThrowProxy<FakeService>('storage');
    expect(() => proxy.value).toThrow('Add storage configuration');
  });

  test('does not throw for Symbol.toPrimitive', () => {
    const proxy = createThrowProxy<FakeService>('storage');
    expect(
      (proxy as unknown as Record<symbol, unknown>)[Symbol.toPrimitive],
    ).toBeUndefined();
  });

  test('does not throw for Symbol.toStringTag', () => {
    const proxy = createThrowProxy<FakeService>('storage');
    expect(
      (proxy as unknown as Record<symbol, unknown>)[Symbol.toStringTag],
    ).toBeUndefined();
  });
});
