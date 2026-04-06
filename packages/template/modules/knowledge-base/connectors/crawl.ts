import type { IntegrationsService } from '@vobase/core';
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
  limit?: number;
  depth?: number;
}

/**
 * Cloudflare Browser Rendering connector.
 * Uses the /crawl REST API: POST to start crawl, GET to poll for results.
 * Credentials: reads from integrations vault ('cloudflare'), falls back to env vars.
 */
export function createCrawlConnector(
  config: CrawlConfig,
  integrations?: IntegrationsService,
): DocumentSource {
  async function getCredentials(): Promise<{
    apiToken: string;
    accountId: string;
  }> {
    // Vault-first, env var fallback
    const cfIntegration = await integrations?.getActive('cloudflare');
    const apiToken =
      (cfIntegration?.config.apiToken as string) ??
      process.env.CLOUDFLARE_API_TOKEN;
    const accountId =
      (cfIntegration?.config.accountId as string) ??
      process.env.CLOUDFLARE_ACCOUNT_ID;

    if (!apiToken || !accountId) {
      throw new Error(
        'Cloudflare credentials not found. Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID env vars, or configure a "cloudflare" integration via the platform.',
      );
    }

    return { apiToken, accountId };
  }

  async function startCrawl(): Promise<string> {
    const { apiToken, accountId } = await getCredentials();
    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering`;

    const res = await http.fetch(`${baseUrl}/crawl`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: {
        url: config.url,
        limit: config.limit ?? 10,
        depth: config.depth ?? 2,
        formats: ['markdown'],
      },
    });
    if (!res.ok)
      throw new Error(
        `Crawl start failed: ${res.status} ${await res.raw.text()}`,
      );
    // POST returns { success: true, result: "<job-id>" }
    const data = res.data as { result: string };
    return data.result;
  }

  async function pollCrawl(
    jobId: string,
  ): Promise<Array<{ url: string; markdown: string }>> {
    const { apiToken, accountId } = await getCredentials();
    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering`;
    const pollUrl = `${baseUrl}/crawl/${jobId}`;

    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      const res = await http.fetch(pollUrl, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      if (!res.ok) throw new Error(`Crawl poll failed: ${res.status}`);
      const data = res.data as {
        result: {
          status: string;
          records?: Array<{ url: string; status: string; markdown?: string }>;
        };
      };
      if (data.result.status === 'completed') {
        return (data.result.records ?? [])
          .filter((r) => r.status === 'completed' && r.markdown)
          .map((r) => ({ url: r.url, markdown: r.markdown as string }));
      }
      if (data.result.status === 'errored') {
        throw new Error('Crawl failed');
      }
      // Wait before polling again (5s between polls as per Cloudflare guidance)
      await new Promise((r) => setTimeout(r, 5000));
    }
    throw new Error('Crawl timed out');
  }

  // Cache crawl results for listDocuments/fetchDocument
  let crawlResults: Array<{ url: string; markdown: string }> | null = null;

  return {
    name: 'Web Crawl',
    type: 'crawl',

    async *listDocuments(): AsyncGenerator<ExternalDocument> {
      const jobId = await startCrawl();
      crawlResults = await pollCrawl(jobId);
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
