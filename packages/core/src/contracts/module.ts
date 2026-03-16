import type { VobaseDb } from '../db/client';
import type { HttpClient } from '../infra/http-client';
import type { ChannelsService } from '../modules/channels/service';
import type { IntegrationsService } from '../modules/integrations/service';
import type { StorageService } from '../modules/storage/service';
import type { Scheduler } from '../infra/queue';

/**
 * Context passed to a module's `init` hook during app boot.
 * Provides access to core infrastructure services.
 */
export interface ModuleInitContext {
  db: VobaseDb;
  scheduler: Scheduler;
  storage: StorageService;
  http: HttpClient;
  channels: ChannelsService;
  integrations: IntegrationsService;
}
