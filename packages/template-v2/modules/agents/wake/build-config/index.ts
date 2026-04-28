/**
 * Barrel for wake-config flavours. Existing callers (`wake/handler.ts`)
 * import `buildWakeConfig` from `'./build-config'`; that path now resolves
 * here. Standalone handlers import from `./standalone` directly.
 */

export { type Capability, resolveCapability } from '../capability'
export { type BuildWakeConfigInput, buildWakeConfig, type WakeConfig } from './conversation'
export {
  type BuildStandaloneWakeConfigInput,
  buildStandaloneWakeConfig,
  type StandaloneTriggerKind,
} from './standalone'
