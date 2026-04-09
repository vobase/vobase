import {
  boolean,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { authPgSchema } from '../../db/pg-schemas';

export const authUser = authPgSchema.table('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  role: text('role').notNull().default('user'),
  isAnonymous: boolean('is_anonymous').default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const authSession = authPgSchema.table(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    activeOrganizationId: text('active_organization_id'),
    activeTeamId: text('active_team_id'),
  },
  (table) => [
    index('session_user_id_idx').on(table.userId),
    index('session_expires_at_idx').on(table.expiresAt),
  ],
);

export const authAccount = authPgSchema.table(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true,
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('account_user_id_idx').on(table.userId)],
);

export const authVerification = authPgSchema.table(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

// API Key table (better-auth apiKey plugin)
// Note: better-auth uses `referenceId` (not `userId`) to link keys to users.
export const authApikey = authPgSchema.table(
  'apikey',
  {
    id: text('id').primaryKey(),
    configId: text('config_id').notNull().default('default'),
    name: text('name'),
    start: text('start'),
    referenceId: text('reference_id').notNull(),
    prefix: text('prefix'),
    key: text('key').notNull(),
    refillInterval: text('refill_interval'),
    refillAmount: integer('refill_amount'),
    lastRefillAt: timestamp('last_refill_at', { withTimezone: true }),
    enabled: boolean('enabled').notNull().default(true),
    rateLimitEnabled: boolean('rate_limit_enabled').notNull().default(false),
    rateLimitTimeWindow: integer('rate_limit_time_window').default(86400000),
    rateLimitMax: integer('rate_limit_max').default(10),
    requestCount: integer('request_count').notNull().default(0),
    remaining: integer('remaining'),
    lastRequest: timestamp('last_request', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    permissions: text('permissions'),
    metadata: text('metadata'),
  },
  (table) => [
    index('apikey_reference_id_idx').on(table.referenceId),
    index('apikey_key_idx').on(table.key),
    index('apikey_config_id_idx').on(table.configId),
  ],
);

// Organization tables (better-auth organization plugin)
export const authOrganization = authPgSchema.table('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  metadata: text('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const authMember = authPgSchema.table(
  'member',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => authOrganization.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('member_user_id_idx').on(table.userId),
    index('member_org_id_idx').on(table.organizationId),
    uniqueIndex('member_user_org_unique_idx').on(
      table.userId,
      table.organizationId,
    ),
  ],
);

export const authInvitation = authPgSchema.table(
  'invitation',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => authOrganization.id, { onDelete: 'cascade' }),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    status: text('status').notNull().default('pending'),
    teamId: text('team_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('invitation_org_id_idx').on(table.organizationId),
    index('invitation_inviter_id_idx').on(table.inviterId),
    index('invitation_email_idx').on(table.email),
  ],
);

// Team tables (better-auth organization teams feature)
export const authTeam = authPgSchema.table(
  'team',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => authOrganization.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('team_org_id_idx').on(table.organizationId)],
);

export const authTeamMember = authPgSchema.table(
  'team_member',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => authTeam.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('team_member_team_id_idx').on(table.teamId),
    index('team_member_user_id_idx').on(table.userId),
  ],
);

export const authTableMap = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
};

export const apikeyTableMap = {
  apikey: authApikey,
};

export const organizationTableMap = {
  organization: authOrganization,
  member: authMember,
  invitation: authInvitation,
  team: authTeam,
  teamMember: authTeamMember,
};
