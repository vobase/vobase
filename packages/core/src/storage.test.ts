import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { createStorage } from './storage';
import { VobaseError } from './errors';

const testBasePath = '/tmp/vobase-test-storage';

beforeAll(() => {
  // Clean up and create test directory
  try {
    rmSync(testBasePath, { recursive: true, force: true });
  } catch {}
  mkdirSync(testBasePath, { recursive: true });
});

afterAll(() => {
  // Clean up test directory
  try {
    rmSync(testBasePath, { recursive: true, force: true });
  } catch {}
});

describe('Storage', () => {
  it('rejects paths with ..', () => {
    const storage = createStorage(testBasePath);
    
    expect(() => {
      storage.getUrl('../etc/passwd');
    }).toThrow(VobaseError);
  });

  it('upload then download returns same bytes', async () => {
    const storage = createStorage(testBasePath);
    const testData = new Uint8Array([1, 2, 3, 4, 5]);
    
    await storage.upload('test-file.bin', testData);
    const downloaded = await storage.download('test-file.bin');
    
    expect(downloaded).toEqual(testData);
  });

  it('getUrl returns correct format', () => {
    const storage = createStorage(testBasePath);
    const url = storage.getUrl('documents/file.txt');
    
    expect(url).toBe('/data/files/documents/file.txt');
  });

  it('delete removes file', async () => {
    const storage = createStorage(testBasePath);
    const testData = new Uint8Array([42]);
    
    await storage.upload('to-delete.bin', testData);
    await storage.delete('to-delete.bin');
    
    // Trying to download deleted file should error
    expect(async () => {
      await storage.download('to-delete.bin');
    }).toThrow();
  });

  it('normalizes paths correctly', async () => {
    const storage = createStorage(testBasePath);
    const testData = new Uint8Array([99]);
    
    // Leading slashes should be removed
    await storage.upload('/normalized.bin', testData);
    const url = storage.getUrl('/normalized.bin');
    
    expect(url).toBe('/data/files/normalized.bin');
    const downloaded = await storage.download('normalized.bin');
    expect(downloaded).toEqual(testData);
  });
});
