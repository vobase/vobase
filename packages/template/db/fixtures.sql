-- Permanent fixtures entry point — extensions + nanoid + functions + triggers.
--
-- Applied by `db:push` before `drizzle-kit push` so schema DDL that depends on
-- `nanoid()` / pgcrypto / vector has those in place. These same fixtures are
-- baked once into the initial drizzle migration for the `db:migrate` path.
--
-- This is the PERMANENT counterpart to `current.sql`, which is the transient
-- staging area for one-off inline DML. Use --!include for glob support.

-- Extensions
--!include extensions/*.sql

-- Functions
--!include fixtures/functions/*.sql

-- Triggers
--!include fixtures/triggers/*.sql
