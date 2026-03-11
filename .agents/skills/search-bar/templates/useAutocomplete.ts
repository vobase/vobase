/**
 * React hook wrapping the pure autocomplete engine.
 * Handles session-cached API hydration and keyboard-navigation state.
 *
 * Part of the vobase search skill.
 */

import { useEffect, useRef, useState } from 'react';
import { buildCorpus, getCompletions, type Completions, type Corpus } from '@/lib/autocomplete';

const CACHE_TTL = 15 * 60 * 1000; // 15 min

export interface AutocompleteConfig {
  /** Domain-specific seed phrases for the autocomplete corpus. */
  seed: string[];
  /** Category names merged into the corpus alongside the seed. */
  categories: string[];
  /** API endpoint that returns `{ suggestions: string[] }` for corpus hydration. */
  suggestionsUrl?: string;
  /** sessionStorage key used to cache the fetched suggestions. */
  cacheKey?: string;
}

export interface AutocompleteState extends Completions {
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  dismiss: () => void;
  /** Re-enable autocomplete (e.g. when the input is re-focused). */
  resetDismissed: () => void;
  /** Accept either the active suggestion or the ghost. Returns the accepted string. */
  accept: () => string | null;
}

export function useAutocomplete(input: string, config: AutocompleteConfig): AutocompleteState {
  const {
    seed,
    categories,
    suggestionsUrl = '/api/search/suggestions',
    cacheKey = 'autocomplete_corpus_v1',
  } = config;

  const [corpus, setCorpus] = useState<Corpus>(() => buildCorpus(seed, categories, []));
  const [dismissed, setDismissed] = useState(true);
  const [activeIndex, setActiveIndex] = useState(-1);
  const prevInput = useRef(input);

  // Clear dismissed state and reset active index whenever the input changes
  useEffect(() => {
    if (input !== prevInput.current) {
      setDismissed(false);
      setActiveIndex(-1);
      prevInput.current = input;
    }
  }, [input]);

  // Hydrate corpus from sessionStorage cache, falling back to a fresh API fetch
  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const raw = sessionStorage.getItem(cacheKey);
        if (raw) {
          const { suggestions, fetchedAt } = JSON.parse(raw) as { suggestions: string[]; fetchedAt: number };
          if (Date.now() - fetchedAt < CACHE_TTL) {
            if (!cancelled) setCorpus(buildCorpus(seed, categories, suggestions));
            return;
          }
        }
      } catch { /* malformed cache — fall through to fetch */ }

      try {
        const res = await fetch(suggestionsUrl);
        if (!res.ok || cancelled) return;
        const { suggestions } = await res.json() as { suggestions: string[] };
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ suggestions, fetchedAt: Date.now() })); } catch { /* storage full */ }
        if (!cancelled) setCorpus(buildCorpus(seed, categories, suggestions));
      } catch { /* network error — static corpus is fine */ }
    }

    hydrate();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { ghost, ghostFull, suggestions } =
    dismissed || !input.trim()
      ? { ghost: null, ghostFull: null, suggestions: [] }
      : getCompletions(corpus, input, 8);

  function dismiss() {
    setDismissed(true);
    setActiveIndex(-1);
  }

  function resetDismissed() {
    setDismissed(false);
    setActiveIndex(-1);
  }

  function accept(): string | null {
    if (activeIndex >= 0 && suggestions[activeIndex]) return suggestions[activeIndex];
    if (ghostFull !== null) return ghostFull;
    return null;
  }

  return { ghost, ghostFull, suggestions, activeIndex, setActiveIndex, dismiss, resetDismissed, accept };
}
