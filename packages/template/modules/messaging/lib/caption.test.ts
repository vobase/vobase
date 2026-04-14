import { describe, expect, it, vi } from 'bun:test';

import { getCaptionForContentType } from './caption';

describe('getCaptionForContentType', () => {
  it('returns placeholder for audio without storage', async () => {
    const result = await getCaptionForContentType(
      'audio',
      undefined,
      undefined,
      undefined,
    );
    expect(result).toBe('(voice message — transcription not yet available)');
  });

  it('returns placeholder for video without storage', async () => {
    const result = await getCaptionForContentType(
      'video',
      undefined,
      undefined,
      undefined,
    );
    expect(result).toBe('(video — description not yet available)');
  });

  it('returns null for unknown content type', async () => {
    const result = await getCaptionForContentType(
      'sticker',
      undefined,
      undefined,
      undefined,
    );
    expect(result).toBeNull();
  });

  it('returns null for image without storage', async () => {
    const result = await getCaptionForContentType(
      'image',
      'some/key.jpg',
      'image/jpeg',
      undefined,
    );
    expect(result).toBeNull();
  });

  it('returns null for image without storageKey', async () => {
    const mockStorage = {
      bucket: () => ({ download: vi.fn() }),
    } as never;
    const result = await getCaptionForContentType(
      'image',
      undefined,
      'image/jpeg',
      mockStorage,
    );
    expect(result).toBeNull();
  });

  it('returns null for document without storage', async () => {
    const result = await getCaptionForContentType(
      'document',
      'some/key.pdf',
      'application/pdf',
      undefined,
    );
    expect(result).toBeNull();
  });
});

describe('captionDocument — text file fast path', () => {
  it('reads small text files directly without AI', async () => {
    const textContent = 'Hello, this is a test CSV\nname,value\nfoo,bar';
    const mockBucket = {
      download: vi.fn().mockResolvedValue(Buffer.from(textContent)),
    };
    const mockStorage = {
      bucket: vi.fn().mockReturnValue(mockBucket),
    } as never;

    const { captionDocument } = await import('./caption');
    const result = await captionDocument(
      'conv/msg/data.csv',
      'text/csv',
      mockStorage,
    );

    expect(result).toBe(textContent);
    expect(mockBucket.download).toHaveBeenCalledWith('conv/msg/data.csv');
  });

  it('returns null for empty text files', async () => {
    const mockBucket = {
      download: vi.fn().mockResolvedValue(Buffer.from('')),
    };
    const mockStorage = {
      bucket: vi.fn().mockReturnValue(mockBucket),
    } as never;

    const { captionDocument } = await import('./caption');
    const result = await captionDocument(
      'conv/msg/empty.txt',
      'text/plain',
      mockStorage,
    );

    expect(result).toBeNull();
  });

  it('returns null on download failure', async () => {
    const mockBucket = {
      download: vi.fn().mockRejectedValue(new Error('not found')),
    };
    const mockStorage = {
      bucket: vi.fn().mockReturnValue(mockBucket),
    } as never;

    const { captionDocument } = await import('./caption');
    const result = await captionDocument(
      'conv/msg/missing.txt',
      'text/plain',
      mockStorage,
    );

    expect(result).toBeNull();
  });
});
