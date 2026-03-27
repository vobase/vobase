import { createHttpClient } from '@vobase/core';

import type {
  ConnectorConfig,
  DocumentContent,
  DocumentSource,
  ExternalDocument,
} from './types';

const http = createHttpClient();

interface CrawlConfig extends ConnectorConfig {
  url: string;
  maxPages?: number;
  maxDepth?: number;
}

/**
 * Cloudflare Browser Rendering connector.
 * Uses the /crawl REST API: POST to start crawl, GET to poll for results.
 */
export function createCrawlConnector(config: CrawlConfig): DocumentSource {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering`;

  async function startCrawl(): Promise<string> {
    const res = await http.fetch(`${baseUrl}/crawl`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: {
        url: config.url,
        maxPages: config.maxPages ?? 10,
        maxDepth: config.maxDepth ?? 2,
        scrapeOptions: { formats: ['markdown'] },
      },
    });
    if (!res.ok)
      throw new Error(
        `Crawl start failed: ${res.status} ${await res.raw.text()}`,
      );
    const data = res.data as { result: { crawlId: string } };
    return data.result.crawlId;
  }

  async function pollCrawl(
    crawlId: string,
  ): Promise<Array<{ url: string; markdown: string }>> {
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
      const res = await http.fetch(`${baseUrl}/crawl/${crawlId}`, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      if (!res.ok) throw new Error(`Crawl poll failed: ${res.status}`);
      const data = res.data as {
        result: {
          status: string;
          data?: Array<{ url: string; markdown: string }>;
        };
      };
      if (data.result.status === 'complete') {
        return data.result.data ?? [];
      }
      if (data.result.status === 'error') {
        throw new Error('Crawl failed');
      }
      // Wait before polling again
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error('Crawl timed out');
  }

  // Cache crawl results for listDocuments/fetchDocument
  let crawlResults: Array<{ url: string; markdown: string }> | null = null;

  return {
    name: 'Web Crawl',
    type: 'crawl',

    async *listDocuments(): AsyncGenerator<ExternalDocument> {
      const crawlId = await startCrawl();
      crawlResults = await pollCrawl(crawlId);
      for (const page of crawlResults) {
        yield {
          externalId: page.url,
          title: page.url,
          mimeType: 'text/markdown',
          sourceUrl: page.url,
        };
      }
    },

    async fetchDocument(externalId: string): Promise<DocumentContent> {
      const page = crawlResults?.find((p) => p.url === externalId);
      if (!page) throw new Error(`Page not found: ${externalId}`);
      return { text: page.markdown, metadata: { url: page.url } };
    },
  };
}
