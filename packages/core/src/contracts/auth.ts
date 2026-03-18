/**
 * Core contract for authentication. The auth adapter translates an incoming
 * request into a user identity. Core uses this in the session middleware
 * to populate ctx.user. The built-in auth module implements this via
 * better-auth; users can swap in their own implementation.
 */
export interface AuthAdapter {
  /**
   * Extract user identity from a request. Returns null if unauthenticated.
   * Must not throw — return null for invalid/expired sessions.
   */
  getSession(headers: Headers): Promise<AuthSession | null>;

  /**
   * The raw request handler for auth routes (sign-in, sign-up, etc.)
   * Mounted at /api/auth/* by the auth module.
   */
  handler: (request: Request) => Promise<Response>;

  /**
   * Create a trusted session for a platform-authenticated user.
   * Finds or creates the user by email, then creates a session.
   * Only used by the platform callback — caller must have already verified
   * the platform JWT. Returns session token for Set-Cookie, or null on failure.
   */
  createPlatformSession?: (profile: {
    email: string;
    name: string;
    provider: string;
    providerId: string;
  }) => Promise<{ token: string; sessionId: string; userId: string } | null>;
}

export interface AuthSession {
  user: AuthUser;
  session: {
    id: string;
    expiresAt: Date;
    token: string;
  };
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  /** Set when the user has an active organization (better-auth organization plugin) */
  activeOrganizationId?: string;
}
