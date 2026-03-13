import { tool } from 'ai';
import { z } from 'zod';
import type { VobaseDb } from '@vobase/core';

type KBResult = {
  found: boolean;
  message?: string;
  results?: Array<{
    content: string;
    source: string;
    documentId: string;
    score: number;
  }>;
};

/**
 * RAG tool: search the knowledge base and return relevant chunks with citations.
 */
export function createKnowledgeBaseTool(db: VobaseDb, sourceIds?: string[]) {
  return tool<{ query: string }, KBResult>({
    description:
      'Search the knowledge base for relevant information. Use this when the user asks a question that might be answered by documents in the knowledge base.',
    inputSchema: z.object({
      query: z.string().describe('The search query to find relevant documents'),
    }),
    execute: async (input) => {
      const { hybridSearch } = await import('../../knowledge-base/lib/search');
      const results = await hybridSearch(db, input.query, {
        limit: 5,
        sourceIds,
      });

      if (results.length === 0) {
        return { found: false, message: 'No relevant documents found.' };
      }

      return {
        found: true,
        results: results.map((r) => ({
          content: r.content,
          source: r.documentTitle,
          documentId: r.documentId,
          score: r.score,
        })),
      };
    },
  });
}
