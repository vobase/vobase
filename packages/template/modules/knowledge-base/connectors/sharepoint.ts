import { getCredential, setCredential } from '@vobase/core';
import type { VobaseDb } from '@vobase/core';

import type { ConnectorConfig, DocumentContent, DocumentSource, ExternalDocument } from './types';

export interface SharePointConfig extends ConnectorConfig {
  siteId?: string;
  driveId?: string;
}

/**
 * SharePoint connector with OAuth2 delegated flow.
 * Uses Microsoft Graph API for document access.
 */
export function createSharePointConnector(
  config: SharePointConfig,
  db: VobaseDb,
  sourceId: string,
): DocumentSource {
  const credKey = `kb-sharepoint-${sourceId}`;

  async function getAccessToken(): Promise<string> {
    const tokenData = await getCredential(db, credKey);
    if (!tokenData) throw new Error('SharePoint not connected. Please authorize first.');

    const parsed = JSON.parse(tokenData) as {
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
    };

    // Refresh if expired
    if (Date.now() >= parsed.expiresAt) {
      // @azure/msal-node is an optional peer dependency (marked --external in build)
      // @ts-expect-error — @azure/msal-node may not be installed
      const { ConfidentialClientApplication } = await import('@azure/msal-node');
      const cca = new ConfidentialClientApplication({
        auth: {
          clientId: process.env.MICROSOFT_CLIENT_ID!,
          clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
          authority: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}`,
        },
      });

      const result = await cca.acquireTokenByRefreshToken({
        refreshToken: parsed.refreshToken,
        scopes: ['Files.Read.All', 'Sites.Read.All'],
      });

      if (!result) throw new Error('Token refresh failed');

      const newTokenData = {
        accessToken: result.accessToken,
        refreshToken: parsed.refreshToken,
        expiresAt: result.expiresOn?.getTime() ?? Date.now() + 3600_000,
      };
      await setCredential(db, credKey, JSON.stringify(newTokenData));
      return result.accessToken;
    }

    return parsed.accessToken;
  }

  async function graphFetch(path: string): Promise<Response> {
    const token = await getAccessToken();
    return fetch(`https://graph.microsoft.com/v1.0${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  return {
    name: 'SharePoint',
    type: 'sharepoint',

    async *listDocuments(): AsyncGenerator<ExternalDocument> {
      const drivePath = config.driveId
        ? `/drives/${config.driveId}/root/children`
        : config.siteId
          ? `/sites/${config.siteId}/drive/root/children`
          : '/me/drive/root/children';

      let url: string | null = drivePath;

      while (url) {
        const res = await graphFetch(url);
        if (!res.ok) throw new Error(`Graph API error: ${res.status}`);
        const data = (await res.json()) as {
          value: Array<{
            id: string;
            name: string;
            file?: { mimeType: string };
            webUrl: string;
            lastModifiedDateTime: string;
          }>;
          '@odata.nextLink'?: string;
        };

        for (const item of data.value) {
          if (!item.file) continue; // Skip folders
          yield {
            externalId: item.id,
            title: item.name,
            mimeType: item.file.mimeType,
            sourceUrl: item.webUrl,
            modifiedAt: new Date(item.lastModifiedDateTime),
          };
        }

        url = data['@odata.nextLink']
          ? data['@odata.nextLink'].replace('https://graph.microsoft.com/v1.0', '')
          : null;
      }
    },

    async fetchDocument(externalId: string): Promise<DocumentContent> {
      const drivePath = config.driveId
        ? `/drives/${config.driveId}/items/${externalId}`
        : `/me/drive/items/${externalId}`;

      // Get metadata
      const metaRes = await graphFetch(drivePath);
      if (!metaRes.ok) throw new Error(`Failed to get document: ${metaRes.status}`);
      const meta = (await metaRes.json()) as { name: string; file?: { mimeType: string } };

      // Download content
      const contentRes = await graphFetch(`${drivePath}/content`);
      if (!contentRes.ok) throw new Error(`Failed to download: ${contentRes.status}`);

      const text = await contentRes.text();
      return { text, metadata: { name: meta.name, mimeType: meta.file?.mimeType } };
    },
  };
}

/**
 * Generate the OAuth2 authorization URL for SharePoint.
 */
export function getSharePointAuthUrl(sourceId: string): string {
  const clientId = process.env.MICROSOFT_CLIENT_ID!;
  const tenantId = process.env.MICROSOFT_TENANT_ID!;
  const redirectUri = `${process.env.BETTER_AUTH_URL}/api/knowledge-base/oauth/microsoft/callback`;
  const scope = 'Files.Read.All Sites.Read.All offline_access';

  return (
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?` +
    `client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scope)}&state=${sourceId}&response_mode=query`
  );
}

/**
 * Exchange the OAuth2 authorization code for tokens.
 */
export async function exchangeSharePointCode(
  db: VobaseDb,
  sourceId: string,
  code: string,
): Promise<void> {
  // @ts-ignore - @azure/msal-node is an optional peer dependency
  const { ConfidentialClientApplication } = await import('@azure/msal-node');
  const cca = new ConfidentialClientApplication({
    auth: {
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      authority: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}`,
    },
  });

  const result = await cca.acquireTokenByCode({
    code,
    scopes: ['Files.Read.All', 'Sites.Read.All'],
    redirectUri: `${process.env.BETTER_AUTH_URL}/api/knowledge-base/oauth/microsoft/callback`,
  });

  const tokenData = {
    accessToken: result.accessToken,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    refreshToken: (result as any).refreshToken ?? '',
    expiresAt: result.expiresOn?.getTime() ?? Date.now() + 3600_000,
  };
  await setCredential(db, `kb-sharepoint-${sourceId}`, JSON.stringify(tokenData));
}
