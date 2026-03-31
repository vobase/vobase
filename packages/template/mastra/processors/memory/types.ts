import { z } from 'zod';

// --- Memory Scope ---

/** Memory is always scoped by contactId. All conversation participants have a contact record. */
export type MemoryScope = { contactId: string };

// --- Memory Config ---

export interface MemoryConfig {
  /** Max tokens before force-splitting a MemCell (default: 8192) */
  maxTokens: number;
  /** Max messages before force-splitting a MemCell (default: 50) */
  maxMessages: number;
  /** Embedding dimensions (from AI config) */
  embeddingDimensions: number;
}

export const defaultMemoryConfig: MemoryConfig = {
  maxTokens: 8192,
  maxMessages: 50,
  embeddingDimensions: 1536,
};

// --- Boundary Detection ---

export const boundaryResultSchema = z.object({
  shouldSplit: z.boolean(),
  reason: z.string(),
});

export type BoundaryResult = z.infer<typeof boundaryResultSchema>;

// --- Episode Extraction ---

export const episodeSchema = z.object({
  title: z.string().describe('A short descriptive title for the episode'),
  content: z
    .string()
    .describe(
      'Third-person narrative summary preserving key details (names, numbers, times)',
    ),
});

export type Episode = z.infer<typeof episodeSchema>;

// --- EventLog Extraction ---

export const eventLogEntrySchema = z.object({
  fact: z
    .string()
    .describe('A single atomic fact as one sentence with explicit attribution'),
  subject: z
    .string()
    .nullable()
    .describe('Who the fact is about, or null if unclear'),
  occurredAt: z
    .string()
    .nullable()
    .describe('ISO timestamp of when the fact occurred, or null if unknown'),
});

export const eventLogSchema = z.object({
  facts: z.array(eventLogEntrySchema),
});

export type EventLogEntry = z.infer<typeof eventLogEntrySchema>;

// --- Retrieval Results ---

export interface MemoryRetrievalResult {
  episodes: Array<{
    id: string;
    cellId: string;
    title: string;
    content: string;
    score: number;
  }>;
  facts: Array<{
    id: string;
    cellId: string;
    fact: string;
    subject: string | null;
    score: number;
  }>;
  originalMessages: Array<{
    content: string;
    role: string;
    createdAt: Date;
  }>;
}

// --- Simple Message Type (for pipeline input) ---

export interface MemoryMessage {
  id: string;
  content: string | null;
  aiRole: string | null;
  createdAt: Date;
}
