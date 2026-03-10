// Re-export system tables from @vobase/core.
// These tables are created by ensureCoreTables() at startup.
// Do not define them locally — @vobase/core is the source of truth.
export { auditLog, sequences, recordAudits } from '@vobase/core';
