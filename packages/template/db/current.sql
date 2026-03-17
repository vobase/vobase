-- Fixtures entry point
-- Use --!include to include SQL files with glob support
-- Run `bun run db:current` to apply during development
-- Run `bun run db:commit` to bake into a migration

-- Extensions
--!include extensions/*.sql

-- Functions
--!include fixtures/functions/*.sql

-- Triggers
--!include fixtures/triggers/*.sql
