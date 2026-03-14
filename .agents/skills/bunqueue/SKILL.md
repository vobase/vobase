---
name: bunqueue
description: "Guides and best practices for working with bunqueue — the high-performance job queue for Bun with SQLite persistence. Use this skill whenever working with background jobs, job queues, workers, scheduled/cron tasks, job flows, stall detection, dead letter queues, or the bunqueue library in a Bun project. Also use when the user mentions 'bunqueue', 'job queue', 'background jobs', 'worker queue', 'task queue', or wants to add async job processing to their Bun/Hono app. Vobase core already wraps bunqueue — use this skill to understand the underlying API when extending or debugging that integration."
---

# bunqueue — Job Queue for Bun + SQLite

bunqueue is a TypeScript job queue for Bun with SQLite persistence (WAL mode), zero external dependencies. Vobase core wraps it via `createScheduler()` and `createWorker()` in `packages/core/src/infra/queue.ts` and `job.ts`.

## Quick Reference

```typescript
import { Queue, Worker, FlowProducer, QueueGroup, shutdownManager } from 'bunqueue/client';
```

Vobase uses **embedded mode** exclusively — always pass `embedded: true` to both Queue and Worker.

### Persistence

Set `DATA_PATH` env var **before** importing bunqueue. Without it, jobs are in-memory only.

```typescript
process.env.DATA_PATH = './data/bunqueue.db';
import { Queue, Worker } from 'bunqueue/client';
```

### Core Pattern

```typescript
// Typed queue
const queue = new Queue<MyJobData>('emails', { embedded: true });

// Add job with options
await queue.add('send-welcome', { to: 'user@example.com' }, {
  priority: 10,      // higher = first
  delay: 5000,       // ms before processing
  attempts: 3,       // max retries
  backoff: 1000,     // backoff base (exponential + jitter)
  durable: true,     // immediate disk write (bypasses write buffer)
  jobId: 'unique-id' // deduplication
});

// Worker
const worker = new Worker<MyJobData>('emails', async (job) => {
  await job.updateProgress(50, 'Sending...');
  await job.log('Processing step 1');
  await sendEmail(job.data);
  return { sent: true };
}, { embedded: true, concurrency: 5 });

// Events
worker.on('completed', (job, result) => { /* ... */ });
worker.on('failed', (job, error) => { /* ... */ });

// Graceful shutdown
process.on('SIGINT', async () => {
  await worker.close();
  shutdownManager();
  process.exit(0);
});
```

### Vobase Integration

Vobase core provides a thin wrapper. Use `ctx.scheduler.add()` in handlers and `defineJob()` in modules:

```typescript
// In a module's jobs
import { defineJob } from '@vobase/core';

export const processDocument = defineJob('process-document', async (data) => {
  // job logic
});

// In a route handler
app.post('/api/documents', async (c) => {
  const ctx = getCtx(c);
  await ctx.scheduler.add('process-document', { docId: '123' }, { priority: 5 });
});
```

## Reference Docs

For detailed API docs, read the reference files in `references/`:

| File | When to read |
|------|-------------|
| `queue.md` | Queue API — add, bulk, repeatable, dedup, DLQ config, rate limiting, clean/maintenance |
| `worker.md` | Worker API — concurrency, heartbeats, events, SandboxedWorker, batch pulling |
| `flow.md` | FlowProducer — sequential chains, parallel fan-out/merge, tree structures |
| `cron.md` | Cron/repeatable jobs — cron expressions, timezone support, intervals |
| `stall-detection.md` | Stall detection — heartbeats, grace periods, recovery |
| `dlq.md` | Dead letter queue — auto-retry, filtering, stats, purging |
| `hono.md` | Hono integration — middleware patterns, job status endpoints |
| `queue-group.md` | QueueGroup — namespace isolation, multi-tenant, bulk ops |
| `rate-limiting.md` | Rate limiting — embedded mode uses worker concurrency |
| `introduction.md` | Overview, architecture, feature comparison |
| `installation.md` | Install, verify, TypeScript types |
| `quickstart.md` | Full quick start tutorial |

### Updating References

```bash
bun run .agents/skills/bunqueue/scripts/download-references.ts
```

## Key Patterns

### Repeatable/Cron Jobs

```typescript
await queue.add('daily-report', { type: 'sales' }, {
  repeat: { pattern: '0 9 * * *', tz: 'America/New_York' }
});

await queue.add('heartbeat', {}, {
  repeat: { every: 60000, limit: 100 }
});
```

### Job Deduplication

```typescript
// BullMQ-style — returns existing job if jobId already exists
await queue.add('sync', data, { jobId: 'sync-user-123' });

// TTL-based with replace strategy
await queue.add('latest-state', data, {
  deduplication: { id: 'state-key', ttl: 300000, replace: true }
});
```

### Stall Detection + DLQ

```typescript
queue.setStallConfig({
  enabled: true, stallInterval: 30000, maxStalls: 3, gracePeriod: 5000
});

queue.setDlqConfig({
  autoRetry: true, autoRetryInterval: 3600000, maxAutoRetries: 3,
  maxAge: 604800000, maxEntries: 10000
});
```

### FlowProducer (Job Dependencies)

```typescript
const flow = new FlowProducer({ embedded: true });

// Sequential: A -> B -> C
await flow.addChain([
  { name: 'fetch', queueName: 'pipeline', data: {} },
  { name: 'process', queueName: 'pipeline', data: {} },
  { name: 'store', queueName: 'pipeline', data: {} },
]);

// Parallel then merge
await flow.addBulkThen(
  [{ name: 'a', queueName: 'q', data: {} }, { name: 'b', queueName: 'q', data: {} }],
  { name: 'merge', queueName: 'q', data: {} }
);
```

### Durable Jobs

Use `durable: true` for critical jobs (payments, orders) — immediate disk write instead of buffered (~10k vs ~100k ops/sec).

### SandboxedWorker (CPU-Intensive)

```typescript
import { SandboxedWorker } from 'bunqueue/client';

const worker = new SandboxedWorker('heavy', {
  processor: './processor.ts',
  concurrency: 4,
  timeout: 60000,
  maxMemory: 256,
});
await worker.start();
```
