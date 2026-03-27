import type { IntegrationsService } from '@vobase/core';

import type {
  ConnectorConfig,
  DocumentContent,
  DocumentSource,
  ExternalDocument,
} from './types';

interface GoogleDriveConfig extends ConnectorConfig {
  folderId?: string;
  integrationId?: string;
}

/**
 * Google Drive connector with OAuth2 user-delegated flow.
 * Tokens stored encrypted via integrations module.
 */
export function createGoogleDriveConnector(
  config: GoogleDriveConfig,
  integrations: IntegrationsService,
  integrationId: string,
): DocumentSource {
  async function getAuth() {
    // googleapis is an optional peer dependency (marked --external in build)
    // @ts-expect-error — googleapis may not be installed
    const { google } = await import('googleapis');
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.BETTER_AUTH_URL}/api/knowledge-base/oauth/google/callback`,
    );

    const integration = await integrations.getById(integrationId);
    if (integration?.config) {
      auth.setCredentials(integration.config);
    }

    auth.on('tokens', async (newTokens: Record<string, unknown>) => {
      const existing = auth.credentials;
      const merged = { ...existing, ...newTokens };
      await integrations.updateConfig(integrationId, merged);
    });

    return { auth, drive: google.drive({ version: 'v3', auth }) };
  }

  return {
    name: 'Google Drive',
    type: 'google-drive',

    async *listDocuments(): AsyncGenerator<ExternalDocument> {
      const { drive } = await getAuth();
      let pageToken: string | undefined;

      do {
        const query = config.folderId
          ? `'${config.folderId}' in parents and trashed = false`
          : 'trashed = false';

        const res = await drive.files.list({
          q: query,
          fields:
            'nextPageToken, files(id, name, mimeType, webViewLink, modifiedTime)',
          pageSize: 100,
          pageToken,
        });

        for (const file of res.data.files ?? []) {
          yield {
            externalId: file.id ?? '',
            title: file.name ?? 'Untitled',
            mimeType: file.mimeType ?? 'application/octet-stream',
            sourceUrl: file.webViewLink ?? undefined,
            modifiedAt: file.modifiedTime
              ? new Date(file.modifiedTime)
              : undefined,
          };
        }

        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
    },

    async fetchDocument(externalId: string): Promise<DocumentContent> {
      const { drive } = await getAuth();

      // Get file metadata
      const meta = await drive.files.get({
        fileId: externalId,
        fields: 'mimeType, name',
      });

      const mimeType = meta.data.mimeType ?? '';

      // Google Docs/Sheets/Slides: export as plain text
      if (mimeType.startsWith('application/vnd.google-apps.')) {
        const exportMime = 'text/plain';
        const res = await drive.files.export(
          { fileId: externalId, mimeType: exportMime },
          { responseType: 'text' },
        );
        return { text: String(res.data), metadata: { name: meta.data.name } };
      }

      // Other files: download content
      const res = await drive.files.get(
        { fileId: externalId, alt: 'media' },
        { responseType: 'text' },
      );
      return { text: String(res.data), metadata: { name: meta.data.name } };
    },
  };
}

/**
 * Generate the OAuth2 authorization URL for Google Drive.
 */
export async function getGoogleAuthUrl(sourceId: string): Promise<string> {
  // @ts-expect-error - googleapis is an optional peer dependency
  const { google } = await import('googleapis');
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.BETTER_AUTH_URL}/api/knowledge-base/oauth/google/callback`,
  );

  return auth.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive.readonly'],
    state: sourceId,
    prompt: 'consent',
  });
}

/**
 * Exchange the OAuth2 authorization code for tokens and create an integration.
 */
export async function exchangeGoogleCode(
  integrations: IntegrationsService,
  sourceId: string,
  code: string,
  opts?: { createdBy?: string; label?: string },
): Promise<string> {
  // @ts-expect-error - googleapis is an optional peer dependency
  const { google } = await import('googleapis');
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.BETTER_AUTH_URL}/api/knowledge-base/oauth/google/callback`,
  );

  const { tokens } = await auth.getToken(code);
  const integration = await integrations.connect(
    'google-drive',
    tokens as Record<string, unknown>,
    {
      authType: 'oauth2',
      scopes: ['drive.readonly'],
      createdBy: opts?.createdBy,
      label: opts?.label ?? `KB source ${sourceId}`,
    },
  );
  return integration.id;
}
