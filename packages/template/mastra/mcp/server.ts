import type { VobaseDb } from '@vobase/core';
import { z } from 'zod';

/**
 * Create an MCP request handler that exposes AI tools to external MCP clients.
 *
 * Uses @modelcontextprotocol/sdk directly — same pattern as core's /mcp endpoint.
 * Tools exposed: search_knowledge_base
 *
 * Mounted at /api/ai/mcp — SEPARATE from core's /mcp discovery endpoint.
 */
export function createAiMcpHandler(
  db: VobaseDb,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const { McpServer } = await import(
      '@modelcontextprotocol/sdk/server/mcp.js'
    );
    const { WebStandardStreamableHTTPServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
    );

    const server = new McpServer({
      name: 'vobase-ai',
      version: '0.1.0',
    });

    // Register search_knowledge_base tool
    server.registerTool(
      'search_knowledge_base',
      {
        description:
          'Search the knowledge base for relevant documents using hybrid search (vector + keyword).',
        inputSchema: {
          query: z.string().describe('The search query'),
          limit: z
            .number()
            .optional()
            .describe('Maximum number of results (default: 5)'),
        },
      },
      async ({ query, limit }) => {
        const { hybridSearch } = await import(
          '../../modules/knowledge-base/lib/search'
        );
        const results = await hybridSearch(db, query, {
          limit: limit ?? 5,
        });

        return {
          content: results.map((r) => ({
            type: 'text' as const,
            text: JSON.stringify({
              documentTitle: r.documentTitle,
              content: r.content,
              score: r.score,
              chunkIndex: r.chunkIndex,
            }),
          })),
        };
      },
    );

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await server.connect(transport);

    try {
      return await transport.handleRequest(req);
    } finally {
      await server.close();
    }
  };
}
