/**
 * Test-only registry-reset hooks.
 *
 * Importable as `@vobase/core/test-utils` so production code never sees these
 * symbols in autocomplete and bundlers can prune them in non-test builds.
 */

export { __resetDeclarativeBindingsForTests } from './declarative/boot'
export { __resetDeclarativeRegistryForTests } from './declarative/define'
export { __resetRefGraphForTests } from './declarative/refgraph'
export { __resetViewablesForTests } from './declarative/viewable'
export { __resetApprovalGateForTests } from './harness/approval-gate'
export { __resetCostServiceForTests } from './harness/cost'
export { __resetCostCapForTests } from './harness/cost-cap'
export { __resetJournalServiceForTests } from './harness/journal'
export { __resetSubagentRegistryForTests } from './harness/subagent'
