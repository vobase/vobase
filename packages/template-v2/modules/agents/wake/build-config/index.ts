/**
 * Barrel for wake-config flavours. Existing callers (`wake/handler.ts`)
 * import `buildWakeConfig` from `'./build-config'`; that path now resolves
 * here. Operator handlers (10.6 / 10.7) import from `./operator` directly.
 */

export { type BuildWakeConfigInput, buildWakeConfig, type WakeConfig } from './concierge'
export { type BuildOperatorWakeConfigInput, buildOperatorWakeConfig, type OperatorTriggerKind } from './operator'
