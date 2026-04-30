/**
 * agents service barrel — agent-definition access.
 * Harness persistence (journal, cost, active-wakes, message-history) lives in
 * `@vobase/core`; consumers import those directly.
 */

export * as agentDefinitions from './agent-definitions'
