import { getCredential, setCredential } from '@vobase/core';
import type { VobaseDb } from '@vobase/core';

import type { ConnectorConfig, DocumentContent, DocumentSource, ExternalDocument } from './types';

export interface GoogleDriveConfig extends ConnectorConfig {
  folderId?: string;
}

/**
 * Google Drive connector with OAuth2 user-delegated flow.
 * Tokens stored encrypted via credentials module.
 */
export function createGoogleDriveConnector(
  config: GoogleDriveConfig,
  db: VobaseDb,
  sourceId: string,
): DocumentSource {
  const credKey = `kb-gdrive-${sourceId}`;

  async function getAuth() {
    // googleapis is an optional peer dependency (marked --external in build)
    // @ts-expect-error — googleapis may not be installed
    const { google } = await import('googleapis');
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.BETTER_AUTH_URL}/api/knowledge-base/oauth/google/callback`,
    );

    const tokens = await getCredential(db, credKey);
    if (tokens) {
      auth.setCredentials(JSON.parse(tokens));
    }

    auth.on('tokens', async (newTokens: Record<string, unknown>) => {
      const existing = auth.credentials;
      const merged = { ...existing, ...newTokens };
      await setCredential(db, credKey, JSON.stringify(merged));
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
          fields: 'nextPageToken, files(id, name, mimeType, webViewLink, modifiedTime)',
          pageSize: 100,
          pageToken,
        });

        for (const file of res.data.files ?? []) {
          yield {
            externalId: file.id!,
            title: file.name ?? 'Untitled',
            mimeType: file.mimeType ?? 'application/octet-stream',
            sourceUrl: file.webViewLink ?? undefined,
            modifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : undefined,
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
  // @ts-ignore - googleapis is an optional peer dependency
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
 * Exchange the OAuth2 authorization code for tokens.
 */
export async function exchangeGoogleCode(
  db: VobaseDb,
  sourceId: string,
  code: string,
): Promise<void> {
  // @ts-ignore - googleapis is an optional peer dependency
  const { google } = await import('googleapis');
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.BETTER_AUTH_URL}/api/knowledge-base/oauth/google/callback`,
  );

  const { tokens } = await auth.getToken(code);
  await setCredential(db, `kb-gdrive-${sourceId}`, JSON.stringify(tokens));
}
