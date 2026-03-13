export interface ChunkOptions {
  maxTokens?: number; // Default: 512
  overlap?: number; // Default: 50 tokens overlap between chunks
}

export interface Chunk {
  content: string;
  index: number;
  tokenCount: number;
}

/**
 * Recursively chunk text: sections → paragraphs → sentences → tokens.
 * Each level tries to split at natural boundaries before falling back to smaller units.
 */
export function recursiveChunk(text: string, options?: ChunkOptions): Chunk[] {
  const maxTokens = options?.maxTokens ?? 512;
  const overlap = options?.overlap ?? 50;

  // Rough token estimation: ~4 chars per token
  const estimateTokens = (s: string) => Math.ceil(s.length / 4);

  function splitRecursive(text: string, separators: string[]): string[] {
    if (estimateTokens(text) <= maxTokens) return [text];
    if (separators.length === 0) {
      // Last resort: split by character count
      const pieces: string[] = [];
      const chunkSize = maxTokens * 4;
      for (let i = 0; i < text.length; i += chunkSize - overlap * 4) {
        pieces.push(text.slice(i, i + chunkSize));
      }
      return pieces;
    }

    const [sep, ...remainingSeps] = separators;
    const parts = text.split(sep).filter((p) => p.trim());

    // If separator didn't split the text, try the next finer separator
    if (parts.length <= 1) {
      return splitRecursive(text, remainingSeps);
    }

    const result: string[] = [];
    let current = '';

    for (const part of parts) {
      const candidate = current ? current + sep + part : part;
      if (estimateTokens(candidate) > maxTokens && current) {
        result.push(current);
        // Add overlap from end of previous chunk
        const overlapText = current.slice(-(overlap * 4));
        current = overlapText + sep + part;
        if (estimateTokens(current) > maxTokens) {
          // Part itself is too big, recurse with smaller separators
          result.push(...splitRecursive(part, remainingSeps));
          current = '';
        }
      } else if (estimateTokens(candidate) > maxTokens && !current) {
        // Single part exceeds limit, recurse with smaller separators
        result.push(...splitRecursive(part, remainingSeps));
      } else {
        current = candidate;
      }
    }
    if (current.trim()) result.push(current);
    return result;
  }

  // Separators from coarsest to finest
  const separators = [
    '\n## ', // Markdown H2
    '\n### ', // Markdown H3
    '\n\n', // Paragraphs
    '\n', // Lines
    '. ', // Sentences
    ' ', // Words
  ];

  const rawChunks = splitRecursive(text, separators);

  return rawChunks
    .map((content, index) => ({
      content: content.trim(),
      index,
      tokenCount: estimateTokens(content.trim()),
    }))
    .filter((c) => c.content.length > 0);
}
