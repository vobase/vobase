import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import { createTestPGlite } from '../../test-helpers';
import type { AuthModuleConfig } from './config';
import { autoJoinOrganization } from './index';
import {
  authInvitation,
  authMember,
  authOrganization,
  authUser,
} from './schema';

// ---------------------------------------------------------------------------
// Database bootstrap
// ---------------------------------------------------------------------------
const ORG_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS "auth"."user" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL UNIQUE,
    "email_verified" BOOLEAN NOT NULL DEFAULT FALSE,
    "image" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "is_anonymous" BOOLEAN NOT NULL DEFAULT FALSE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS "auth"."session" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "token" TEXT NOT NULL UNIQUE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "ip_address" TEXT,
    "user_agent" TEXT,
    "user_id" TEXT NOT NULL REFERENCES "auth"."user" ("id") ON DELETE CASCADE,
    "active_organization_id" TEXT
  );
  CREATE TABLE IF NOT EXISTS "auth"."organization" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL UNIQUE,
    "logo" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS "auth"."member" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "user_id" TEXT NOT NULL REFERENCES "auth"."user" ("id") ON DELETE CASCADE,
    "organization_id" TEXT NOT NULL REFERENCES "auth"."organization" ("id") ON DELETE CASCADE,
    "role" TEXT NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "member_user_org_unique_idx"
    ON "auth"."member" ("user_id", "organization_id");
  CREATE TABLE IF NOT EXISTS "auth"."invitation" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "email" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL REFERENCES "auth"."organization" ("id") ON DELETE CASCADE,
    "inviter_id" TEXT NOT NULL REFERENCES "auth"."user" ("id") ON DELETE CASCADE,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "team_id" TEXT,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------
let pg: PGlite;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  pg = await createTestPGlite();
  await pg.exec(ORG_TABLES_SQL);
  db = drizzle({ client: pg });
});

// Clean data between tests (keep tables)
beforeEach(async () => {
  await pg.exec(`
    DELETE FROM "auth"."invitation";
    DELETE FROM "auth"."member";
    DELETE FROM "auth"."organization";
    DELETE FROM "auth"."user";
  `);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function insertUser(id: string, email: string, name = 'Test User') {
  await db.insert(authUser).values({ id, name, email });
}

async function insertOrg(id: string, name: string, slug: string) {
  await db.insert(authOrganization).values({ id, name, slug });
}

async function insertMember(userId: string, orgId: string, role = 'member') {
  await db.insert(authMember).values({
    id: crypto.randomUUID(),
    userId,
    organizationId: orgId,
    role,
  });
}

async function insertInvitation(
  id: string,
  email: string,
  orgId: string,
  inviterId: string,
  opts?: { role?: string; status?: string },
) {
  await db.insert(authInvitation).values({
    id,
    email,
    organizationId: orgId,
    inviterId,
    role: opts?.role ?? 'member',
    status: opts?.status ?? 'pending',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
}

async function getMembers(userId: string) {
  return db.select().from(authMember).where(eq(authMember.userId, userId));
}

async function getInvitation(id: string) {
  const [inv] = await db
    .select()
    .from(authInvitation)
    .where(eq(authInvitation.id, id));
  return inv;
}

// ===========================================================================
// Tests
// ===========================================================================

describe('autoJoinOrganization', () => {
  describe('existing membership', () => {
    it('returns existing org ID when user already belongs to an org', async () => {
      await insertUser('u1', 'alice@example.com');
      await insertOrg('org1', 'Acme', 'acme');
      await insertMember('u1', 'org1');

      const result = await autoJoinOrganization(db, 'u1', 'alice@example.com');
      expect(result).toBe('org1');

      // No duplicate membership created
      const members = await getMembers('u1');
      expect(members).toHaveLength(1);
    });
  });

  describe('invitation auto-accept', () => {
    it('accepts pending invitation and creates membership', async () => {
      await insertUser('admin1', 'admin@example.com', 'Admin');
      await insertUser('u2', 'bob@example.com', 'Bob');
      await insertOrg('org1', 'Acme', 'acme');
      await insertMember('admin1', 'org1', 'owner');
      await insertInvitation('inv1', 'bob@example.com', 'org1', 'admin1', {
        role: 'admin',
      });

      const result = await autoJoinOrganization(db, 'u2', 'bob@example.com');
      expect(result).toBe('org1');

      // Member created with invited role
      const members = await getMembers('u2');
      expect(members).toHaveLength(1);
      expect(members[0].role).toBe('admin');
      expect(members[0].organizationId).toBe('org1');

      // Invitation marked accepted
      const inv = await getInvitation('inv1');
      expect(inv.status).toBe('accepted');
    });

    it('works in multi-org mode (invitation-based join always works)', async () => {
      await insertUser('admin1', 'admin@example.com', 'Admin');
      await insertUser('u3', 'carol@example.com', 'Carol');
      await insertOrg('org-a', 'Team A', 'team-a');
      await insertMember('admin1', 'org-a', 'owner');
      await insertInvitation('inv2', 'carol@example.com', 'org-a', 'admin1');

      const config: AuthModuleConfig = { multiOrg: true };
      const result = await autoJoinOrganization(
        db,
        'u3',
        'carol@example.com',
        config,
      );
      expect(result).toBe('org-a');

      const members = await getMembers('u3');
      expect(members).toHaveLength(1);
    });

    it('ignores non-pending invitations (already accepted)', async () => {
      await insertUser('admin1', 'admin@example.com', 'Admin');
      await insertUser('u4', 'dave@example.com', 'Dave');
      await insertOrg('org1', 'Acme', 'acme');
      await insertMember('admin1', 'org1', 'owner');
      await insertInvitation('inv3', 'dave@example.com', 'org1', 'admin1', {
        status: 'accepted',
      });

      const result = await autoJoinOrganization(db, 'u4', 'dave@example.com');
      expect(result).toBeNull();

      const members = await getMembers('u4');
      expect(members).toHaveLength(0);
    });

    it('ignores cancelled invitations', async () => {
      await insertUser('admin1', 'admin@example.com', 'Admin');
      await insertUser('u5', 'eve@example.com', 'Eve');
      await insertOrg('org1', 'Acme', 'acme');
      await insertMember('admin1', 'org1', 'owner');
      await insertInvitation('inv4', 'eve@example.com', 'org1', 'admin1', {
        status: 'cancelled',
      });

      const result = await autoJoinOrganization(db, 'u5', 'eve@example.com');
      expect(result).toBeNull();
    });
  });

  describe('domain-based auto-join (single-org mode)', () => {
    it('auto-joins when email domain matches allowedEmailDomains', async () => {
      await insertUser('u6', 'frank@acme.com', 'Frank');
      await insertOrg('org1', 'Acme', 'acme');

      const config: AuthModuleConfig = {
        allowedEmailDomains: ['acme.com'],
      };
      const result = await autoJoinOrganization(
        db,
        'u6',
        'frank@acme.com',
        config,
      );
      expect(result).toBe('org1');

      const members = await getMembers('u6');
      expect(members).toHaveLength(1);
      expect(members[0].role).toBe('owner');
    });

    it('subsequent domain-matched members get member role', async () => {
      await insertUser('u6a', 'first@acme.com', 'First');
      await insertUser('u6b', 'second@acme.com', 'Second');
      await insertOrg('org1', 'Acme', 'acme');

      const config: AuthModuleConfig = {
        allowedEmailDomains: ['acme.com'],
      };
      // First user becomes owner
      await autoJoinOrganization(db, 'u6a', 'first@acme.com', config);
      // Second user becomes member
      const result = await autoJoinOrganization(
        db,
        'u6b',
        'second@acme.com',
        config,
      );
      expect(result).toBe('org1');

      const members = await getMembers('u6b');
      expect(members).toHaveLength(1);
      expect(members[0].role).toBe('member');
    });

    it('domain matching is case-insensitive', async () => {
      await insertUser('u7', 'grace@ACME.COM', 'Grace');
      await insertOrg('org1', 'Acme', 'acme');

      const config: AuthModuleConfig = {
        allowedEmailDomains: ['Acme.Com'],
      };
      const result = await autoJoinOrganization(
        db,
        'u7',
        'grace@ACME.COM',
        config,
      );
      expect(result).toBe('org1');
    });

    it('returns null when domain does not match', async () => {
      await insertUser('u8', 'hank@other.com', 'Hank');
      await insertOrg('org1', 'Acme', 'acme');

      const config: AuthModuleConfig = {
        allowedEmailDomains: ['acme.com'],
      };
      const result = await autoJoinOrganization(
        db,
        'u8',
        'hank@other.com',
        config,
      );
      expect(result).toBeNull();

      const members = await getMembers('u8');
      expect(members).toHaveLength(0);
    });

    it('returns null when no org exists', async () => {
      await insertUser('u9', 'iris@acme.com', 'Iris');

      const config: AuthModuleConfig = {
        allowedEmailDomains: ['acme.com'],
      };
      const result = await autoJoinOrganization(
        db,
        'u9',
        'iris@acme.com',
        config,
      );
      expect(result).toBeNull();
    });

    it('returns null when no allowedEmailDomains configured', async () => {
      await insertUser('u10', 'jack@acme.com', 'Jack');
      await insertOrg('org1', 'Acme', 'acme');

      const result = await autoJoinOrganization(db, 'u10', 'jack@acme.com');
      expect(result).toBeNull();
    });
  });

  describe('multi-org mode blocks domain auto-join', () => {
    it('does NOT auto-join via domain when multiOrg is true', async () => {
      await insertUser('u11', 'kate@acme.com', 'Kate');
      await insertOrg('org1', 'Acme', 'acme');
      await insertOrg('org2', 'Beta', 'beta');

      const config: AuthModuleConfig = {
        multiOrg: true,
        allowedEmailDomains: ['acme.com'],
      };
      const result = await autoJoinOrganization(
        db,
        'u11',
        'kate@acme.com',
        config,
      );
      expect(result).toBeNull();

      const members = await getMembers('u11');
      expect(members).toHaveLength(0);
    });
  });

  describe('invitation takes priority over domain match', () => {
    it('accepts invitation even when domain also matches', async () => {
      await insertUser('admin1', 'admin@acme.com', 'Admin');
      await insertUser('u12', 'lily@acme.com', 'Lily');
      await insertOrg('org1', 'Acme', 'acme');
      await insertMember('admin1', 'org1', 'owner');
      await insertInvitation('inv5', 'lily@acme.com', 'org1', 'admin1', {
        role: 'admin',
      });

      const config: AuthModuleConfig = {
        allowedEmailDomains: ['acme.com'],
      };
      const result = await autoJoinOrganization(
        db,
        'u12',
        'lily@acme.com',
        config,
      );
      expect(result).toBe('org1');

      // Should have the invitation role (admin), not the domain-join role (member)
      const members = await getMembers('u12');
      expect(members).toHaveLength(1);
      expect(members[0].role).toBe('admin');

      // Invitation should be marked as accepted
      const inv = await getInvitation('inv5');
      expect(inv.status).toBe('accepted');
    });
  });
});
