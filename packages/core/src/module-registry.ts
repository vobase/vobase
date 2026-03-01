import { conflict } from './errors';
import type { VobaseModule } from './module';

export function registerModules(
  modules: VobaseModule[],
): Map<string, VobaseModule> {
  const registry = new Map<string, VobaseModule>();

  for (const module of modules) {
    if (registry.has(module.name)) {
      throw conflict(`Module "${module.name}"`);
    }

    registry.set(module.name, module);
  }

  return registry;
}
