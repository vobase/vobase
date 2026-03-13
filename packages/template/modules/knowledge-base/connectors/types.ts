export interface ExternalDocument {
  externalId: string;
  title: string;
  mimeType: string;
  sourceUrl?: string;
  modifiedAt?: Date;
}

export interface DocumentContent {
  text: string;
  metadata?: Record<string, unknown>;
}

export interface DocumentSource {
  name: string;
  type: string;

  /** List available documents from the external source */
  listDocuments(): AsyncGenerator<ExternalDocument>;

  /** Fetch the text content of a specific document */
  fetchDocument(externalId: string): Promise<DocumentContent>;
}

export interface ConnectorConfig {
  [key: string]: unknown;
}
