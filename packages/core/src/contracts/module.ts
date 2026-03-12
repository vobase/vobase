import type { VobaseDb } from '../db/client';
import type { HttpClient } from '../http-client';
import type { NotifyService } from '../modules/notify/service';
import type { StorageService } from '../modules/storage/service';
import type { Scheduler } from '../queue';

/**
 * Context passed to a module's `init` hook during app boot.
 * Provides access to core infrastructure services.
 */
export interface ModuleInitContext {
  db: VobaseDb;
  scheduler: Scheduler;
  storage: StorageService;
  http: HttpClient;
  notify: NotifyService;
}
