import { pgSchema } from 'drizzle-orm/pg-core';

/** Auth module schema — user, session, account, verification, apikey, organization, member, invitation */
export const authPgSchema = pgSchema('auth');

/** Audit module schema — audit_log, record_audits */
export const auditPgSchema = pgSchema('audit');

/** Infrastructure schema — sequences, channels, integrations, storage, webhooks */
export const infraPgSchema = pgSchema('infra');
