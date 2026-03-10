import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './modules/*/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: { url: './data/vobase.db' },
  tablesFilter: [
    '!user',
    '!session',
    '!account',
    '!verification',
    '!_audit_log',
    '!_sequences',
    '!_record_audits',
  ],
});
