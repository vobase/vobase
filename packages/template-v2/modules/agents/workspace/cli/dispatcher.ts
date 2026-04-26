/**
 * Thin re-export — the canonical dispatcher lives in `@vobase/core`. This
 * file used to own the implementation; the move into core (Slice 7.1) keeps
 * the just-bash dispatcher in a single place so downstream tenant projects
 * inherit role-aware verb-set support and collision detection without
 * forking the helpdesk template.
 */

export {
  type AgentRole,
  createVobaseCommand,
  DEFAULT_READ_ONLY_VERBS,
  findCommand,
  resolveCommandSet,
  VobaseCliCollisionError,
  type VobaseDispatcherOpts,
} from '@vobase/core'
