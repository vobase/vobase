---
name: vobase-search-bar
description: Add a hybrid vector+FTS search bar with autocomplete to a vobase/React app. Invoke when the user asks to add, build, or implement a search bar or search feature.
---

# vobase Search Bar Skill

Implements a production-ready search bar for a vobase + React project. The implementation is split into two layers:

1. **Generic layer** — framework files that never change across projects (copy verbatim)
2. **Config layer** — domain-specific data the developer fills in for their app

---

## Step 1 — Gather domain config from the user

Before writing any files, ask (or infer from existing code) the following:

- **`CATEGORIES`** — list of category/filter chip names for the search UI
- **`EXAMPLES`** — animated placeholder phrases shown in the search bar (20–100 items)
- **`FIELD_WEIGHTS`** — which DB columns matter for lexical scoring and how much
  - typical: `{ category: 3.0, description: 1.0, tags: 2.0 }`
- **`STOPWORDS`** — high-frequency terms that appear in every listing and add no signal
  - always include general English stopwords; add domain-specific ones (e.g. `'agent'`, `'product'`)
- **`CATEGORY_SIGNALS`** — keywords per category that indicate a user is searching in that vertical (optional but improves ranking)
- **`CATEGORY_SPECIFICITY`** — 0.0–1.0 niche score per category (0 = broad, 1 = very niche) (optional)

---

## Step 2 — Create the generic layer (copy verbatim)

Create these files exactly as specified in `templates/`. They are domain-agnostic and should not be modified.

### `lib/search-engine.ts`
Copy from `templates/search-engine.ts`. Provides:
- `getEmbeddingCache(rawDb, tableName?)` — loads pre-computed embeddings from DB into memory
- `invalidateEmbeddingCache()` — drops cache after a write
- `cosineSimilarity(a, b)` — dot-product cosine distance
- `vectorSearch(queryVec, cache, topK, minSimilarity)` — top-K by cosine similarity
- `embedQuery(query)` — embeds a query string with 10-min LRU cache
- `tokenize(q, stopwords)` — lowercases and strips stopwords
- `extractIntent(raw)` — detects implied budget/sort from natural-language query
- `warmupEmbedModel()` — pre-warms the ONNX model at startup

### `lib/local-embed.ts`
Copy from `templates/local-embed.ts`. Wraps `@xenova/transformers` with:
- Lazy dynamic import so ONNX failures don't crash the server
- Graceful degradation to keyword-only search if model is unavailable
- Model: `Xenova/all-MiniLM-L6-v2` (384-dim, quantized, ~23 MB)

### `src/lib/autocomplete.ts`
Copy from `templates/autocomplete.ts`. Pure synchronous engine:
- `buildCorpus(seed, categories, extras)` — deduplicates and merges corpus sources
- `getCompletions(corpus, input, limit)` — prefix-first O(N) matching in <1 ms

### `src/hooks/useAutocomplete.ts`
Copy from `templates/useAutocomplete.ts`. React hook:
- Accepts `AutocompleteConfig { seed, categories, suggestionsUrl?, cacheKey? }`
- Hydrates corpus from a sessionStorage cache (15 min TTL) + API fallback
- Manages `dismissed`, `activeIndex`, ghost text, and dropdown state

### `src/components/search-bar.tsx`
Copy from `templates/search-bar.tsx`. React component:
- Animated cycling placeholder (typing/erasing) when no static `placeholder` prop given
- Google-style dropdown with bold prefix highlighting
- Full keyboard navigation (↑↓ to move, Enter to accept, Esc to dismiss)
- Props: `initialValue?`, `onSearch`, `placeholder?`, `autoFocus?`, `examples?`, `autocompleteConfig?`

---

## Step 3 — Create the config layer (fill in domain data)

### `src/config/search.ts`  ← frontend config
```typescript
// Domain-specific search configuration — edit these for your app.

export const EXAMPLES: string[] = [
  // 20–100 animated placeholder phrases shown in the search bar
  // e.g. 'invoice processing automation', 'customer churn prediction', ...
];

export const CATEGORIES: string[] = [
  // Category names used as filter chips and in autocomplete corpus
  // e.g. 'Sales & Revenue', 'HR & People', ...
];

// Seed for autocomplete: EXAMPLES with any domain suffix stripped
// e.g. strip trailing ' agent' so 'invoice processing automation agent' → 'invoice processing automation'
export const AUTOCOMPLETE_SEED: string[] = EXAMPLES.map((e) =>
  e.endsWith(' <suffix>') ? e.slice(0, -('<suffix>'.length + 1)) : e,
);
```

### `modules/{name}/search-config.ts`  ← backend config
```typescript
// Domain-specific backend search configuration — edit these for your app.

export const CATEGORIES = [ /* same list as frontend */ ];

export const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'for', 'to', 'and', 'or', 'is', 'it',
  'with', 'that', 'this', 'on', 'at', 'by', 'from', 'be', 'as',
  // Domain-specific: add terms that appear in every listing
  // e.g. 'agent', 'product', 'service', 'platform',
]);

// Per-field lexical scoring weights — tune to your DB schema
export const FIELD_WEIGHTS: Record<string, number> = {
  // e.g. category: 3.0, tags: 2.0, description: 1.0
};

// 0.0 = broad (relevant to anyone), 1.0 = very niche (one specific industry)
export const CATEGORY_SPECIFICITY: Record<string, number> = {
  // e.g. 'Customer Service': 0.1, 'Healthcare & Wellness': 0.85,
};

// Keywords that signal the user is searching within a specific vertical
export const CATEGORY_SIGNALS: Record<string, string[]> = {
  // e.g. 'Healthcare & Wellness': ['health', 'patient', 'clinical', ...],
};

export function detectVerticalSignals(rawQuery: string): Set<string> {
  const lq = rawQuery.toLowerCase();
  const signaled = new Set<string>();
  for (const [category, signals] of Object.entries(CATEGORY_SIGNALS)) {
    if (signals.some((sig) => lq.includes(sig))) signaled.add(category);
  }
  return signaled;
}
```

---

## Step 4 — Wire into the backend search handler

In the module's `handlers.ts`, import from both layers and implement the scoring logic:

```typescript
import {
  warmupEmbedModel, getEmbeddingCache, invalidateEmbeddingCache,
  embedQuery, vectorSearch, tokenize, extractIntent,
} from '../../lib/search-engine';
import {
  CATEGORIES, STOPWORDS, FIELD_WEIGHTS, CATEGORY_SPECIFICITY, detectVerticalSignals,
} from './search-config';

warmupEmbedModel().catch(() => {});

// Score bands (with vectors):    semantic (0–55) + lexical (0–25) + quality (0–20) = 100
// Score bands (without vectors): semantic (0)    + lexical (0–80) + quality (0–20) = 100
function scoreItems(items, keywords, vectorScores, verticalSignals, maxDeployments) {
  const hasVectors = vectorScores.size > 0;
  const SINGLE_KW_NORM = FIELD_WEIGHTS.description ?? 1.0;

  return items.map((item) => {
    const semanticScore = (vectorScores.get(item.id) ?? 0) * 55;

    const lexicalCeil = hasVectors ? 25 : 80;
    let lexicalScore = 0;
    if (keywords.length > 0) {
      const fields = { /* map FIELD_WEIGHTS keys to item text values */ };
      let total = 0;
      for (const kw of keywords) {
        let kwScore = 0;
        for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
          if (fields[field]?.includes(kw)) kwScore += weight;
        }
        total += Math.min(kwScore / SINGLE_KW_NORM, 1.0);
      }
      lexicalScore = (total / keywords.length) * lexicalCeil;
    } else {
      lexicalScore = lexicalCeil;
    }

    // Quality score: combine rating, popularity, recency as appropriate for your domain

    const specificity = CATEGORY_SPECIFICITY[item.category] ?? 0.3;
    const categorySignaled = verticalSignals.has(item.category);
    const verticalMultiplier = categorySignaled ? 1.1
      : verticalSignals.size > 0 ? 1.0 - specificity * 0.5
      : 1.0 - specificity * 0.25;

    return { ...item, match_score: Math.min(Math.round((semanticScore + lexicalScore) * verticalMultiplier), 100) };
  });
}
```

### Search route pattern:
```typescript
routes.get('/search', async (c) => {
  const rawDb = (ctx.db as any).$client;
  const { query = '', category, sort_by = 'relevance', limit = '48', offset = '0' } = c.req.query();

  const { cleanQuery, impliedBudget, impliedSort } = extractIntent(query);
  const keywords = tokenize(cleanQuery, STOPWORDS);
  const verticalSignals = detectVerticalSignals(cleanQuery);

  // Vector search
  const vectorScores = new Map<string, number>();
  if (cleanQuery.trim()) {
    const queryVec = await embedQuery(cleanQuery);
    if (queryVec) {
      const cache = getEmbeddingCache(rawDb);
      for (const { agentId, similarity } of vectorSearch(queryVec, cache, 150, 0.35)) {
        vectorScores.set(agentId, similarity);
      }
    }
  }

  // FTS + vector candidate fetch, then score and paginate
  // ...
});
```

---

## Step 5 — Database requirements

The following tables are required for full functionality:

```sql
-- Pre-computed item embeddings
CREATE TABLE IF NOT EXISTS agent_embeddings (
  agent_id TEXT PRIMARY KEY,
  embedding TEXT NOT NULL,  -- JSON Float32Array
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- FTS5 virtual table — adjust columns to your schema
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  category, description, tags,
  content='items', content_rowid='rowid'
);

-- Impression/click tracking for quality score
CREATE TABLE IF NOT EXISTS item_click_stats (
  item_id TEXT PRIMARY KEY,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  click_rate REAL DEFAULT 0,
  updated_at INTEGER
);
```

Run the embed script after seeding data:
```bash
bun scripts/embed.ts         # skip already-embedded
bun scripts/embed.ts --force # re-embed all
```

---

## Step 6 — Use the SearchBar component

```tsx
import { SearchBar } from '@/components/search-bar';
// Uses AbleLayer defaults automatically via src/config/search.ts

// Basic usage
<SearchBar onSearch={(q) => navigate({ search: { query: q } })} />

// With initial value (e.g. on a results page)
<SearchBar initialValue={currentQuery} onSearch={handleSearch} autoFocus />

// With custom config for a different domain
<SearchBar
  examples={MY_EXAMPLES}
  autocompleteConfig={{ seed: MY_SEED, categories: MY_CATEGORIES }}
  onSearch={handleSearch}
/>
```

---

## Checklist

- [ ] `lib/search-engine.ts` copied (generic, verbatim)
- [ ] `lib/local-embed.ts` copied (generic, verbatim)
- [ ] `src/lib/autocomplete.ts` copied (generic, verbatim)
- [ ] `src/hooks/useAutocomplete.ts` copied (generic, verbatim)
- [ ] `src/components/search-bar.tsx` copied (generic, verbatim)
- [ ] `src/config/search.ts` filled with domain EXAMPLES + CATEGORIES
- [ ] `modules/{name}/search-config.ts` filled with FIELD_WEIGHTS, STOPWORDS, CATEGORY_SIGNALS
- [ ] Backend handler imports from both layers and implements `scoreItems`
- [ ] DB tables created (`agent_embeddings`, `items_fts`, `item_click_stats`)
- [ ] Embed script run against seeded data
- [ ] `SearchBar` component placed in the UI with `onSearch` wired to URL navigation
