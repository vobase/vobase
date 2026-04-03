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

/** Validate an API key and return the owning user. Returns null if invalid. */
export type VerifyApiKey = (key: string) => Promise<{ userId: string } | null>;

/** Create a scoped API key for the authenticated user. */
export type CreateApiKey = (opts: {
  headers: Headers | Record<string, string>;
  name?: string;
  expiresIn?: number;
}) => Promise<{ key: string; id: string } | null>;

/** Revoke (disable) an API key by its ID. Returns true if the key was found and revoked. */
export type RevokeApiKey = (keyId: string) => Promise<boolean>;
