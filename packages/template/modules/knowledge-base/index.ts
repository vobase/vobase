import { defineModule } from '@vobase/core';

import { getAIConfig } from '../../lib/ai';
import { loadSqliteVec } from '../../lib/sqlite-vec';
import { knowledgeBaseRoutes } from './handlers';
import * as schema from './schema';

export const knowledgeBaseModule = defineModule({
  name: 'knowledge-base',
  schema,
  routes: knowledgeBaseRoutes,

  init(ctx) {
    const db = ctx.db.$client;

    // Load sqlite-vec extension (may fail if not installed)
    const vecLoaded = loadSqliteVec(db);

    if (vecLoaded) {
      const { embeddingDimensions } = getAIConfig();
      // Create vec0 virtual table for vector embeddings
      db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS kb_embeddings USING vec0(
          rowid INTEGER PRIMARY KEY,
          embedding float[${embeddingDimensions}]
        )
      `);
    }

    // Create FTS5 virtual table for keyword search
    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(
        content,
        content_rowid='rowid'
      )
    `);
  },
});
