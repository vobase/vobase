import { and, eq } from 'drizzle-orm';

import type { VobaseDb } from '../../db/client';
import { logger } from '../../infra/logger';
import { decrypt, encrypt } from './encrypt';
import { integrationsTable } from './schema';

export interface Integration {
  id: string;
  provider: string;
  authType: string;
  label: string | null;
  status: string;
  config: Record<string, unknown>;
  scopes: string[] | null;
  configExpiresAt: Date | null;
  lastRefreshAt: Date | null;
  authFailedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectOptions {
  label?: string;
  authType: string;
  scopes?: string[];
  expiresAt?: Date;
  createdBy?: string;
}

export interface IntegrationsService {
  getActive(provider: string): Promise<Integration | null>;
  getAll(provider: string): Promise<Integration[]>;
  getById(id: string): Promise<Integration | null>;
  connect(
    provider: string,
    config: Record<string, unknown>,
    opts: ConnectOptions,
  ): Promise<Integration>;
  disconnect(id: string): Promise<void>;
  updateConfig(
    id: string,
    config: Record<string, unknown>,
    opts?: { expiresAt?: Date },
  ): Promise<void>;
  markError(id: string, error: string): Promise<void>;
  markRefreshed(id: string): Promise<void>;
}

function decryptConfig(encrypted: string): Record<string, unknown> {
  try {
    return JSON.parse(decrypt(encrypted));
  } catch {
    logger.error('Failed to decrypt integration config');
    return {};
  }
}

function rowToIntegration(
  row: typeof integrationsTable.$inferSelect,
): Integration {
  return {
    id: row.id,
    provider: row.provider,
    authType: row.authType,
    label: row.label,
    status: row.status,
    config: decryptConfig(row.config),
    scopes: row.scopes ? JSON.parse(row.scopes) : null,
    configExpiresAt: row.configExpiresAt,
    lastRefreshAt: row.lastRefreshAt,
    authFailedAt: row.authFailedAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createIntegrationsService(db: VobaseDb): IntegrationsService {
  return {
    async getActive(provider: string): Promise<Integration | null> {
      try {
        const rows = await db
          .select()
          .from(integrationsTable)
          .where(
            and(
              eq(integrationsTable.provider, provider),
              eq(integrationsTable.status, 'active'),
            ),
          )
          .limit(1);
        return rows[0] ? rowToIntegration(rows[0]) : null;
      } catch {
        // Table may not exist yet (e.g., in-memory test DB before db:push)
        return null;
      }
    },

    async getAll(provider: string): Promise<Integration[]> {
      const rows = await db
        .select()
        .from(integrationsTable)
        .where(eq(integrationsTable.provider, provider));
      return rows.map(rowToIntegration);
    },

    async getById(id: string): Promise<Integration | null> {
      const rows = await db
        .select()
        .from(integrationsTable)
        .where(eq(integrationsTable.id, id))
        .limit(1);
      return rows[0] ? rowToIntegration(rows[0]) : null;
    },

    async connect(
      provider: string,
      config: Record<string, unknown>,
      opts: ConnectOptions,
    ): Promise<Integration> {
      const encrypted = encrypt(JSON.stringify(config));
      const rows = await db
        .insert(integrationsTable)
        .values({
          provider,
          authType: opts.authType,
          label: opts.label ?? null,
          status: 'active',
          config: encrypted,
          scopes: opts.scopes ? JSON.stringify(opts.scopes) : null,
          configExpiresAt: opts.expiresAt ?? null,
          createdBy: opts.createdBy ?? null,
        })
        .returning();

      const row = rows[0];
      logger.info(`Integration connected: ${provider}`, {
        id: row.id,
        label: opts.label,
      });
      return rowToIntegration(row);
    },

    async disconnect(id: string): Promise<void> {
      await db
        .update(integrationsTable)
        .set({ status: 'disconnected', updatedAt: new Date() })
        .where(eq(integrationsTable.id, id));
      logger.info('Integration disconnected', { id });
    },

    async updateConfig(
      id: string,
      config: Record<string, unknown>,
      opts?: { expiresAt?: Date },
    ): Promise<void> {
      const encrypted = encrypt(JSON.stringify(config));
      await db
        .update(integrationsTable)
        .set({
          config: encrypted,
          configExpiresAt: opts?.expiresAt ?? null,
          status: 'active',
          authFailedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(integrationsTable.id, id));
    },

    async markError(id: string, error: string): Promise<void> {
      await db
        .update(integrationsTable)
        .set({
          status: 'error',
          authFailedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(integrationsTable.id, id));
      logger.warn('Integration auth failed', { id, error });
    },

    async markRefreshed(id: string): Promise<void> {
      await db
        .update(integrationsTable)
        .set({
          lastRefreshAt: new Date(),
          authFailedAt: null,
          status: 'active',
          updatedAt: new Date(),
        })
        .where(eq(integrationsTable.id, id));
    },
  };
}
