/**
 * PGliteStore — MastraCompositeStore adapter for PGlite (in-process Postgres).
 *
 * PostgresStore from @mastra/pg uses the `pg` TCP driver which cannot connect
 * to PGlite (in-process, no TCP). This adapter wraps PGlite with a DbClient
 * interface and passes it to Mastra's PG domain classes (MemoryPG, WorkflowsPG, etc.).
 *
 * Verified via spike: scripts/spike-mastra-pglite.ts
 */
import type { PGlite } from '@electric-sql/pglite';
import type { StorageDomains } from '@mastra/core/storage';
import { MastraCompositeStore } from '@mastra/core/storage';
import {
  AgentsPG,
  DatasetsPG,
  ExperimentsPG,
  MCPClientsPG,
  MCPServersPG,
  MemoryPG,
  ObservabilityPG,
  PromptBlocksPG,
  ScorerDefinitionsPG,
  ScoresPG,
  SkillsPG,
  WorkflowsPG,
  WorkspacesPG,
} from '@mastra/pg';

/**
 * Detects multi-statement SQL. PGlite's prepared statement API only supports
 * single statements; multi-statement DDL must use PGlite's multi-statement runner.
 */
function hasMultipleStatements(sql: string): boolean {
  const stripped = sql
    .replace(/\$\$[\s\S]*?\$\$/g, '')
    .replace(/'[^']*'/g, '')
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const semicolons = stripped.split(';').filter((s) => s.trim().length > 0);
  return semicolons.length > 1;
}

/**
 * Creates a DbClient-compatible adapter wrapping PGlite.
 * Implements the query methods used by @mastra/pg domain classes.
 */
function createPGliteDbClient(pg: PGlite) {
  async function runQuery(sql: string, values?: unknown[]) {
    const result = await pg.query(sql, values);
    return {
      rows: result.rows as any[],
      command: '',
      rowCount: result.rows.length,
      oid: 0,
      fields: (result.fields || []).map((f: any) => ({
        name: f.name,
        tableID: f.tableID ?? 0,
        columnID: f.columnID ?? 0,
        dataTypeID: f.dataTypeID ?? 0,
        dataTypeSize: f.dataTypeSize ?? -1,
        dataTypeModifier: f.dataTypeModifier ?? -1,
        format: 'text' as const,
      })),
    };
  }

  /** Run multi-statement SQL via PGlite's batch runner */
  async function runMultiStatement(sql: string): Promise<void> {
    // PGlite supports multi-statement via its non-prepared path
    await (pg as any).exec(sql);
  }

  const client = {
    get $pool(): any {
      return null;
    },

    async connect(): Promise<any> {
      throw new Error(
        'PGlite does not support pool connections — use query methods directly',
      );
    },

    async none(sql: string, values?: unknown[]): Promise<null> {
      if (!values?.length && hasMultipleStatements(sql)) {
        await runMultiStatement(sql);
      } else {
        await runQuery(sql, values);
      }
      return null;
    },

    async one<T = any>(sql: string, values?: unknown[]): Promise<T> {
      const result = await runQuery(sql, values);
      if (result.rows.length !== 1) {
        throw new Error(`Expected exactly 1 row, got ${result.rows.length}`);
      }
      return result.rows[0] as T;
    },

    async oneOrNone<T = any>(
      sql: string,
      values?: unknown[],
    ): Promise<T | null> {
      const result = await runQuery(sql, values);
      if (result.rows.length > 1) {
        throw new Error(`Expected 0 or 1 row, got ${result.rows.length}`);
      }
      return (result.rows[0] as T) ?? null;
    },

    async any<T = any>(sql: string, values?: unknown[]): Promise<T[]> {
      const result = await runQuery(sql, values);
      return result.rows as T[];
    },

    async manyOrNone<T = any>(sql: string, values?: unknown[]): Promise<T[]> {
      const result = await runQuery(sql, values);
      return result.rows as T[];
    },

    async many<T = any>(sql: string, values?: unknown[]): Promise<T[]> {
      const result = await runQuery(sql, values);
      if (result.rows.length === 0) {
        throw new Error('Expected at least 1 row, got 0');
      }
      return result.rows as T[];
    },

    query: runQuery,

    async tx<T>(callback: (t: any) => Promise<T>): Promise<T> {
      await runQuery('BEGIN');
      try {
        const txClient = { ...client };
        const result = await callback(txClient);
        await runQuery('COMMIT');
        return result;
      } catch (err) {
        await runQuery('ROLLBACK');
        throw err;
      }
    },
  };

  return client;
}

/**
 * MastraCompositeStore backed by PGlite.
 * Creates PG domain instances (MemoryPG, WorkflowsPG) using a PGlite-backed DbClient.
 */
export class PGliteStore extends MastraCompositeStore {
  stores: StorageDomains;

  constructor(pglite: PGlite) {
    super({ id: 'pglite-store', name: 'PGliteStore' });
    const dbClient = createPGliteDbClient(pglite) as any;
    const domainConfig = { client: dbClient };

    this.stores = {
      memory: new MemoryPG(domainConfig),
      workflows: new WorkflowsPG(domainConfig),
      observability: new ObservabilityPG(domainConfig),
      agents: new AgentsPG(domainConfig),
      datasets: new DatasetsPG(domainConfig),
      experiments: new ExperimentsPG(domainConfig),
      scores: new ScoresPG(domainConfig),
      scorerDefinitions: new ScorerDefinitionsPG(domainConfig),
      promptBlocks: new PromptBlocksPG(domainConfig),
      mcpClients: new MCPClientsPG(domainConfig),
      mcpServers: new MCPServersPG(domainConfig),
      skills: new SkillsPG(domainConfig),
      workspaces: new WorkspacesPG(domainConfig),
    };
  }

  override async init(): Promise<void> {
    for (const domain of Object.values(this.stores)) {
      if (domain) await domain.init();
    }
  }
}
