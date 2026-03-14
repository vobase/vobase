Create job flows with automatic dependency management: sequential chains, parallel execution with merge, and tree structures.

## Basic Usage

```typescript
import { FlowProducer } from 'bunqueue/client';

const flow = new FlowProducer({ embedded: true });
```

## Sequential Chain

Execute jobs in sequence where each job depends on the previous one completing.

```typescript
// A → B → C (sequential execution)
const { jobIds } = await flow.addChain([
  { name: 'fetch', queueName: 'pipeline', data: { url: 'https://api.example.com' } },
  { name: 'process', queueName: 'pipeline', data: {} },
  { name: 'store', queueName: 'pipeline', data: {} },
]);

console.log('Chain job IDs:', jobIds);
// Jobs execute in order: fetch completes → process starts → store starts
```

## Parallel with Merge

Run multiple jobs in parallel, then execute a final job after all complete.

```typescript
//   task1 ──┐
//   task2 ──┼──→ merge
//   task3 ──┘

const { parallelIds, finalId } = await flow.addBulkThen(
  [
    { name: 'fetch-api-1', queueName: 'parallel', data: { source: 'api1' } },
    { name: 'fetch-api-2', queueName: 'parallel', data: { source: 'api2' } },
    { name: 'fetch-api-3', queueName: 'parallel', data: { source: 'api3' } },
  ],
  { name: 'merge-results', queueName: 'parallel', data: {} }
);

console.log('Parallel IDs:', parallelIds);
console.log('Final merge job:', finalId);
```

## Tree Structure

Create hierarchical job trees where children depend on their parent.

```typescript
const { jobIds } = await flow.addTree({
  name: 'root',
  queueName: 'tree',
  data: { level: 0 },
  children: [
    {
      name: 'branch-1',
      queueName: 'tree',
      data: { level: 1 },
      children: [
        { name: 'leaf-1a', queueName: 'tree', data: { level: 2 } },
        { name: 'leaf-1b', queueName: 'tree', data: { level: 2 } },
      ],
    },
    {
      name: 'branch-2',
      queueName: 'tree',
      data: { level: 1 },
    },
  ],
});
```

## Accessing Parent Results

Workers can access results from previous jobs in the chain.

> **Automatic Properties**
> When using FlowProducer, bunqueue automatically injects special properties into job data:
> - `__flowParentId` - Parent job ID (for chain/tree flows)
> - `__flowParentIds` - Array of parent IDs (for merge flows)
> - `__parentId` - Parent job ID (BullMQ v5 compatible)
> - `__parentQueue` - Parent job queue name (BullMQ v5 compatible)
> - `__childrenIds` - Children job IDs (BullMQ v5 compatible)
> 
> These allow child jobs to access parent results. All fields are fully typed via the `FlowJobData` interface — IntelliSense works automatically inside Worker processors.

> **Persistence**
> Parent-child relationships set via `updateJobParent` are persisted to SQLite. Both the parent's `childrenIds` and the child's `__parentId` survive server restarts. This ensures flow dependency graphs remain intact across process restarts when using durable storage.

### `FlowJobData` Type

The `FlowJobData` interface is automatically intersected with your job data type `T` in Worker callbacks. You can also import it explicitly:

```typescript
import type { FlowJobData } from 'bunqueue/client';

interface MyJobData extends FlowJobData {
  email: string;
  subject: string;
}
```

```typescript
import { FlowProducer, Worker } from 'bunqueue/client';

const flow = new FlowProducer({ embedded: true });

const worker = new Worker('pipeline', async (job) => {
  // Check if this job has a parent (chain scenario)
  // __flowParentId is automatically injected by FlowProducer
  if (job.data.__flowParentId) {
    const parentResult = flow.getParentResult(job.data.__flowParentId);
    console.log('Parent result:', parentResult);
  }

  // Check if this job has multiple parents (merge scenario)
  // __flowParentIds is automatically injected for merge flows
  if (job.data.__flowParentIds) {
    const parentResults = flow.getParentResults(job.data.__flowParentIds);
    parentResults.forEach((result, id) => {
      console.log(`Parent ${id}:`, result);
    });
  }

  return { processed: true };
}, { embedded: true });
```

## Job Options

Each step can have its own options.

```typescript
await flow.addChain([
  {
    name: 'fetch',
    queueName: 'pipeline',
    data: { url: '...' },
    opts: {
      priority: 10,
      attempts: 5,
      timeout: 30000,
    },
  },
  {
    name: 'process',
    queueName: 'pipeline',
    data: {},
    opts: {
      delay: 1000,  // Wait 1s after fetch completes
    },
  },
]);
```

## FlowStep Interface

```typescript
interface FlowStep<T = unknown> {
  name: string;           // Job name
  queueName: string;      // Target queue
  data: T;                // Job data
  opts?: JobOptions;      // Optional job options
  children?: FlowStep[];  // Child steps (for tree structures)
}
```

## Methods Reference

| Method | Description |
|--------|-------------|
| `addChain(steps[])` | Sequential execution: A → B → C |
| `addBulkThen(parallel[], final)` | Parallel then converge: [A, B, C] → D |
| `addTree(root)` | Hierarchical tree with nested children |
| `getParentResult(parentId)` | Get result from single parent job |
| `getParentResults(parentIds[])` | Get results from multiple parent jobs |

## Complete Example

```typescript
import { FlowProducer, Worker, Queue, shutdownManager } from 'bunqueue/client';

// Create queues
const pipelineQueue = new Queue('pipeline', { embedded: true });

// Create flow producer
const flow = new FlowProducer({ embedded: true });

// Create worker
const worker = new Worker('pipeline', async (job) => {
  console.log(`Processing ${job.data.name || job.name}`);

  if (job.name === 'fetch') {
    // Simulate API call
    return { data: [1, 2, 3] };
  }

  if (job.name === 'process') {
    // Access parent result
    const fetchResult = flow.getParentResult(job.data.__flowParentId);
    return { processed: fetchResult.data.map(x => x * 2) };
  }

  if (job.name === 'store') {
    const processResult = flow.getParentResult(job.data.__flowParentId);
    console.log('Storing:', processResult.processed);
    return { stored: true };
  }

  return {};
}, { embedded: true, concurrency: 3 });

// Add a pipeline
const { jobIds } = await flow.addChain([
  { name: 'fetch', queueName: 'pipeline', data: {} },
  { name: 'process', queueName: 'pipeline', data: {} },
  { name: 'store', queueName: 'pipeline', data: {} },
]);

console.log('Pipeline started with jobs:', jobIds);

// Cleanup
process.on('SIGINT', async () => {
  await worker.close();
  shutdownManager();
  process.exit(0);
});
```

> **Related Guides**
> - [Queue API](/guide/queue/) - Job options and queue configuration
> - [Worker API](/guide/worker/) - Process flow jobs with workers