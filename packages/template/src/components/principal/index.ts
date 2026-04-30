/**
 * Principal — universal renderer for agent / staff / contact identities with
 * a HoverCard that surfaces full name, id, and kind-specific detail (model,
 * title + on/offline, email/phone). Three variants: `simple` (no avatar),
 * `mention` (`@name` pill), `inbox` (avatar + secondary line).
 *
 * Color convention: purple = agent, blue = staff, green = contact.
 */

export { PrincipalAvatar } from './avatar'
export {
  type AgentMeta,
  type ContactMeta,
  type PrincipalDirectory,
  type PrincipalKind,
  type PrincipalRecord,
  type StaffMeta,
  usePrincipalDirectory,
} from './directory'
export { PrincipalHoverCard } from './hover-card'
export { Principal, type PrincipalProps, type PrincipalVariant } from './principal'
