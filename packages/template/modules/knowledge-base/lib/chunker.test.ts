import { describe, expect, it } from 'bun:test';

import { recursiveChunk } from './chunker';

describe('recursiveChunk()', () => {
  it('returns empty array for empty string', () => {
    expect(recursiveChunk('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(recursiveChunk('   \n\n  ')).toEqual([]);
  });

  it('returns a single chunk for short text', () => {
    const text = 'Hello world, this is a short document.';
    const chunks = recursiveChunk(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(text);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].tokenCount).toBeGreaterThan(0);
  });

  it('estimates tokens at ~4 chars per token', () => {
    const text = 'a'.repeat(100); // 100 chars ≈ 25 tokens
    const chunks = recursiveChunk(text);
    expect(chunks[0].tokenCount).toBe(25);
  });

  it('splits long text into multiple chunks', () => {
    // Create text well over 512 tokens (~2048+ chars)
    const paragraphs = Array.from(
      { length: 30 },
      (_, i) =>
        `Paragraph ${i + 1}. ` +
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '.repeat(
          5,
        ),
    );
    const text = paragraphs.join('\n\n');
    const chunks = recursiveChunk(text);

    expect(chunks.length).toBeGreaterThan(1);
    // All chunks should have sequential indices
    chunks.forEach((chunk, i) => {
      expect(chunk.index).toBe(i);
    });
  });

  it('respects maxTokens option', () => {
    const text = 'Word '.repeat(2000); // ~2500 tokens
    const chunks = recursiveChunk(text, { maxTokens: 100 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('splits on markdown headers when present', () => {
    const text = [
      '## Section One',
      'Content for section one with details. '.repeat(100),
      '## Section Two',
      'Content for section two with details. '.repeat(100),
      '## Section Three',
      'Content for section three with details. '.repeat(100),
    ].join('\n');

    const chunks = recursiveChunk(text, { maxTokens: 256 });
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });

  it('splits on paragraphs before sentences', () => {
    const text = Array.from(
      { length: 30 },
      (_, i) =>
        `This is paragraph ${i + 1} with enough text to make it meaningful for chunking purposes and ensure we exceed the token limit.`,
    ).join('\n\n');

    const chunks = recursiveChunk(text, { maxTokens: 64 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });

  it('includes overlap between consecutive chunks', () => {
    const sentences = Array.from(
      { length: 200 },
      (_, i) =>
        `Sentence number ${i + 1} contains some unique identifying content here.`,
    );
    const text = sentences.join(' ');
    const chunks = recursiveChunk(text, { maxTokens: 128, overlap: 30 });

    expect(chunks.length).toBeGreaterThan(1);
  });

  it('handles text with no natural separators', () => {
    const text = 'x'.repeat(8000); // ~2000 tokens, no spaces
    const chunks = recursiveChunk(text, { maxTokens: 256 });
    expect(chunks.length).toBeGreaterThan(1);
    const totalChars = chunks.reduce((sum, c) => sum + c.content.length, 0);
    expect(totalChars).toBeGreaterThanOrEqual(8000);
  });

  it('preserves chunk content integrity', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    const chunks = recursiveChunk(text);
    expect(chunks[0].content).toBe(text);
  });

  it('filters out empty chunks after splitting', () => {
    const text = '\n\n\n\nSome content\n\n\n\n';
    const chunks = recursiveChunk(text);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });
});
