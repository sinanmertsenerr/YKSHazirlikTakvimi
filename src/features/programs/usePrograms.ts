import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useContentRevisionStore, type Program } from '@/data/content';
import {
  queryProgramById,
  queryProgramCities,
  queryProgramLanguages,
  queryProgramPage,
  type ProgramPageQuery,
} from '@/db/programRepository';
import type { ProgramQueryLanguage } from '@/db/programQueries';

const SEARCH_DEBOUNCE_MS = 250;
const PAGE_SIZE = 60;

type ProgramsState = {
  queryKey: string;
  programs: Program[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
};

function useDebouncedValue(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timeout);
  }, [delay, value]);
  return debounced;
}

export function usePrograms(query: Omit<ProgramPageQuery, 'limit' | 'offset'>) {
  const contentRevision = useContentRevisionStore((state) => state.revision);
  const debouncedSearch = useDebouncedValue(query.search ?? '', SEARCH_DEBOUNCE_MS);
  const stableQuery = useMemo<Omit<ProgramPageQuery, 'limit' | 'offset'>>(
    () => ({
      scoreType: query.scoreType,
      language: query.language,
      search: debouncedSearch,
      city: query.city,
      instructionLanguage: query.instructionLanguage,
      type: query.type,
      scholarship: query.scholarship,
      favoriteIds: query.favoriteIds,
    }),
    [
      debouncedSearch,
      query.city,
      query.favoriteIds,
      query.instructionLanguage,
      query.language,
      query.scholarship,
      query.scoreType,
      query.type,
    ],
  );
  const [state, setState] = useState<ProgramsState>({
    queryKey: '',
    programs: [],
    loading: true,
    loadingMore: false,
    hasMore: false,
  });
  const generation = useRef(0);
  const nextOffset = useRef(PAGE_SIZE);
  const loadingMore = useRef(false);
  const hasMore = useRef(false);
  const loadedQueryKey = useRef('');
  const queryKey = useMemo(
    () => `${contentRevision}:${JSON.stringify(stableQuery)}`,
    [contentRevision, stableQuery],
  );

  useEffect(() => {
    const requestGeneration = ++generation.current;
    nextOffset.current = PAGE_SIZE;
    loadingMore.current = false;
    hasMore.current = false;
    loadedQueryKey.current = '';

    void queryProgramPage({ ...stableQuery, limit: PAGE_SIZE, offset: 0 })
      .then((page) => {
        if (generation.current !== requestGeneration) return;
        hasMore.current = page.hasMore;
        loadedQueryKey.current = queryKey;
        setState({
          queryKey,
          programs: page.programs,
          loading: false,
          loadingMore: false,
          hasMore: page.hasMore,
        });
      })
      .catch(() => {
        if (generation.current !== requestGeneration) return;
        loadedQueryKey.current = queryKey;
        setState({
          queryKey,
          programs: [],
          loading: false,
          loadingMore: false,
          hasMore: false,
        });
      });
  }, [queryKey, stableQuery]);

  const loadMore = useCallback(() => {
    if (loadedQueryKey.current !== queryKey || loadingMore.current || !hasMore.current) return;
    loadingMore.current = true;
    const requestGeneration = generation.current;
    const offset = nextOffset.current;
    setState((current) => ({ ...current, loadingMore: true }));

    void queryProgramPage({ ...stableQuery, limit: PAGE_SIZE, offset })
      .then((page) => {
        if (generation.current !== requestGeneration) return;
        nextOffset.current += PAGE_SIZE;
        hasMore.current = page.hasMore;
        setState((current) => ({
          queryKey,
          programs: [...current.programs, ...page.programs],
          loading: false,
          loadingMore: false,
          hasMore: page.hasMore,
        }));
      })
      .catch(() => {
        if (generation.current !== requestGeneration) return;
        hasMore.current = false;
        setState((current) => ({ ...current, loadingMore: false, hasMore: false }));
      })
      .finally(() => {
        if (generation.current === requestGeneration) loadingMore.current = false;
      });
  }, [queryKey, stableQuery]);

  if (state.queryKey !== queryKey) {
    return {
      programs: [],
      loading: true,
      loadingMore: false,
      hasMore: false,
      loadMore,
    };
  }
  return { ...state, loadMore };
}

export function useProgram(programId: string | undefined) {
  const contentRevision = useContentRevisionStore((state) => state.revision);
  const queryKey = `${contentRevision}:${programId ?? ''}`;
  const [state, setState] = useState<{
    queryKey: string;
    program: Program | null;
    loading: boolean;
  }>({
    queryKey: '',
    program: null,
    loading: true,
  });

  useEffect(() => {
    let active = true;
    if (!programId) {
      return () => {
        active = false;
      };
    }
    void queryProgramById(programId)
      .then((program) => {
        if (active) setState({ queryKey, program, loading: false });
      })
      .catch(() => {
        if (active) setState({ queryKey, program: null, loading: false });
      });
    return () => {
      active = false;
    };
  }, [programId, queryKey]);

  if (!programId) return { program: null, loading: false };
  return state.queryKey === queryKey ? state : { program: null, loading: true };
}

export function useProgramCities(language: ProgramQueryLanguage): string[] {
  const contentRevision = useContentRevisionStore((state) => state.revision);
  const [cities, setCities] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    void queryProgramCities(language)
      .then((next) => {
        if (active) setCities(next);
      })
      .catch(() => {
        if (active) setCities([]);
      });
    return () => {
      active = false;
    };
  }, [contentRevision, language]);
  return cities;
}

export function useProgramLanguages(language: ProgramQueryLanguage): string[] {
  const contentRevision = useContentRevisionStore((state) => state.revision);
  const [languages, setLanguages] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    void queryProgramLanguages(language)
      .then((next) => {
        if (active) setLanguages(next);
      })
      .catch(() => {
        if (active) setLanguages([]);
      });
    return () => {
      active = false;
    };
  }, [contentRevision, language]);
  return languages;
}
