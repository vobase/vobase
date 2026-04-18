# @vobase/template-v2

Greenfield rebuild of `packages/template/` per the r10 architecture spec.

See [`.omc/architecture/r10-refactor/v2-greenfield-spec.md`](../../.omc/architecture/r10-refactor/v2-greenfield-spec.md) for the canonical implementation plan and [`.omc/plans/v2-phase1-plan.md`](../../.omc/plans/v2-phase1-plan.md) for the Phase 1 task breakdown.

Status: **Phase 1 in progress** — foundation + one mocked-stream green-thread wake.

## Dev

```bash
docker compose up -d    # Postgres on port 5433 (side-by-side with packages/template on 5432)
bun install
bun run db:push
bun run db:seed
bun test
```
