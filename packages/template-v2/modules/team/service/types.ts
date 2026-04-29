/**
 * Team service types — agent-facing staff-profile lookup port.
 *
 * `StaffProfileLookup` lives here (not under `agent.ts`) so the type sits
 * next to the service-layer source-of-truth and `agent.ts` stays purely
 * declarative.
 */

export interface StaffProfileLookup {
  /** Returns the display name (name, then email, then staffId) for an auth.user row. */
  getAuthDisplay(staffId: string): Promise<{ name: string | null; email: string | null } | null>
}
