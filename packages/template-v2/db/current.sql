-- Fixtures entry point
-- Use --!include to include SQL files with glob support
-- Run `bun run db:push` to apply during development
-- Run `bun run db:generate` to bake into a migration

-- Extensions
--!include extensions/*.sql

-- Functions
--!include fixtures/functions/*.sql

-- Triggers
--!include fixtures/triggers/*.sql
