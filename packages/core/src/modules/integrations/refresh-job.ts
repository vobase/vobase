import { and, eq, isNotNull, lt } from 'drizzle-orm';

import type { VobaseDb } from '../../db/client';
import { logger } from '../../infra/logger';
import {
  getPlatformRefresh,
  getProviderRefreshFn,
  getRefreshMode,
} from './refresh';
import { integrationsTable } from './schema';
import type { IntegrationsService } from './service';

// Refresh tokens that expire within the next 10 minutes
const REFRESH_WINDOW_MS = 10 * 60 * 1000;

/**
 * Refresh all integrations with expiring tokens.
 * Called by the integrations:refresh-tokens job.
 *
 * Dual-mode logic:
 * - If integration config has clientId + clientSecret + refreshToken → refresh locally
 * - If a platform refresh callback is registered via setPlatformRefresh() → delegate to callback
 * - Otherwise → skip (cannot refresh, mark error if expired)
 */
export async function refreshExpiringTokens(
  db: VobaseDb,
  integrationsService: IntegrationsService,
): Promise<{ refreshed: number; failed: number; skipped: number }> {
  const cutoff = new Date(Date.now() + REFRESH_WINDOW_MS);

  // Find active integrations with tokens expiring soon
  const expiring = await db
    .select()
    .from(integrationsTable)
    .where(
      and(
        eq(integrationsTable.status, 'active'),
        isNotNull(integrationsTable.configExpiresAt),
        lt(integrationsTable.configExpiresAt, cutoff),
      ),
    );

  let refreshed = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of expiring) {
    const integration = await integrationsService.getById(row.id);
    if (!integration) continue;

    const mode = getRefreshMode(integration.config);

    if (!mode) {
      // Cannot refresh — check if already expired
      if (
        integration.configExpiresAt &&
        integration.configExpiresAt < new Date()
      ) {
        await integrationsService.markError(
          integration.id,
          'Token expired, no refresh credentials available',
        );
        logger.warn('[integrations:refresh] Token expired, cannot refresh', {
          id: integration.id,
          provider: integration.provider,
        });
      }
      skipped++;
      continue;
    }

    try {
      if (mode === 'local') {
        // Local refresh: use provider-specific refresh function
        const refreshFn = getProviderRefreshFn(integration.provider);
        if (!refreshFn) {
          logger.warn(
            '[integrations:refresh] No refresh function for provider',
            {
              provider: integration.provider,
            },
          );
          skipped++;
          continue;
        }

        const result = await refreshFn(integration.config);

        // Build updated config — preserve all existing fields, update tokens
        const updatedConfig = { ...integration.config };
        updatedConfig.accessToken = result.accessToken;
        if (result.refreshToken) {
          updatedConfig.refreshToken = result.refreshToken;
        }

        const expiresAt = result.expiresInSeconds
          ? new Date(Date.now() + result.expiresInSeconds * 1000)
          : undefined;

        await integrationsService.updateConfig(integration.id, updatedConfig, {
          expiresAt,
          markRefreshed: true,
        });

        logger.info('[integrations:refresh] Token refreshed locally', {
          id: integration.id,
          provider: integration.provider,
          expiresAt: expiresAt?.toISOString(),
        });
        refreshed++;
      } else {
        // Platform refresh: delegate to registered callback
        const platformRefresh = getPlatformRefresh();
        if (!platformRefresh) {
          logger.warn('[integrations:refresh] Platform mode but no refresh callback registered', {
            id: integration.id,
            provider: integration.provider,
          });
          skipped++;
          continue;
        }

        const result = await platformRefresh(integration.provider);

        const updatedConfig = { ...integration.config };
        updatedConfig.accessToken = result.accessToken;

        const expiresAt = result.expiresInSeconds
          ? new Date(Date.now() + result.expiresInSeconds * 1000)
          : undefined;

        await integrationsService.updateConfig(integration.id, updatedConfig, {
          expiresAt,
          markRefreshed: true,
        });

        logger.info('[integrations:refresh] Token refreshed via platform callback', {
          id: integration.id,
          provider: integration.provider,
          expiresAt: expiresAt?.toISOString(),
        });
        refreshed++;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await integrationsService.markError(integration.id, errorMsg);
      logger.error('[integrations:refresh] Token refresh failed', {
        id: integration.id,
        provider: integration.provider,
        mode,
        error: errorMsg,
      });
      failed++;
    }
  }

  return { refreshed, failed, skipped };
}
