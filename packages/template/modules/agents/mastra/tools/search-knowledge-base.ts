import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { hybridSearch } from '../../../knowledge-base/lib/search';
import type { ModuleDeps } from '../../../messaging/lib/deps';

/**
 * RAG tool: search the knowledge base and return relevant chunks with citations.
 * Reads deps from requestContext. Returns a clear error when unavailable.
 */
export const searchKnowledgeBaseTool = createTool({
  id: 'search_knowledge_base',
  description:
    'Search the knowledge base for relevant information. Use this when the user asks a question that might be answered by documents in the knowledge base.',
  inputSchema: z.object({
    query: z.string().describe('The search query to find relevant documents'),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    message: z.string().optional(),
    results: z
      .array(
        z.object({
          content: z.string(),
          source: z.string(),
          documentId: z.string(),
          score: z.number(),
        }),
      )
      .optional(),
  }),
  execute: async (input, context) => {
    const deps = context?.requestContext?.get('deps') as ModuleDeps | undefined;
    if (!deps) {
      return {
        found: false,
        message:
          'Knowledge base search unavailable — no deps context (Studio context)',
      };
    }

    const results = await hybridSearch(deps.db, input.query, {
      limit: 5,
      mode: 'deep',
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
