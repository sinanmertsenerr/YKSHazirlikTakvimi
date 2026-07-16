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
  error: Error | null;
};

type ProgramFacetsState = {
  queryKey: string;
  cities: string[];
  languages: string[];
  loading: boolean;
  error: Error | null;
};

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function useDebouncedValue(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (value === debounced) return;
    const timeout = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timeout);
  }, [debounced, delay, value]);
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
    error: null,
  });
  const [requestVersion, setRequestVersion] = useState(0);
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
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (generation.current !== requestGeneration) return;
        loadedQueryKey.current = queryKey;
        setState({
          queryKey,
          programs: [],
          loading: false,
          loadingMore: false,
          hasMore: false,
          error: toError(error),
        });
      });
  }, [queryKey, requestVersion, stableQuery]);

  const retry = useCallback(() => {
    loadedQueryKey.current = '';
    setState((current) =>
      current.queryKey === queryKey
        ? { ...current, loading: true, loadingMore: false, error: null }
        : current,
    );
    setRequestVersion((version) => version + 1);
  }, [queryKey]);

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
          error: null,
        }));
      })
      .catch((error: unknown) => {
        if (generation.current !== requestGeneration) return;
        hasMore.current = false;
        setState((current) => ({
          ...current,
          loadingMore: false,
          hasMore: false,
          error: toError(error),
        }));
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
      error: null,
      loadMore,
      retry,
    };
  }
  return { ...state, loadMore, retry };
}

export function useProgram(programId: string | undefined) {
  const contentRevision = useContentRevisionStore((state) => state.revision);
  const queryKey = `${contentRevision}:${programId ?? ''}`;
  const [requestVersion, setRequestVersion] = useState(0);
  const [state, setState] = useState<{
    queryKey: string;
    program: Program | null;
    loading: boolean;
    error: Error | null;
  }>({
    queryKey: '',
    program: null,
    loading: true,
    error: null,
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
        if (active) setState({ queryKey, program, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (active) setState({ queryKey, program: null, loading: false, error: toError(error) });
      });
    return () => {
      active = false;
    };
  }, [programId, queryKey, requestVersion]);

  const retry = useCallback(() => {
    setState((current) =>
      current.queryKey === queryKey
        ? { ...current, program: null, loading: true, error: null }
        : current,
    );
    setRequestVersion((version) => version + 1);
  }, [queryKey]);
  if (!programId) return { program: null, loading: false, error: null, retry };
  return state.queryKey === queryKey
    ? { ...state, retry }
    : { program: null, loading: true, error: null, retry };
}

export function useProgramFacets(language: ProgramQueryLanguage, enabled: boolean) {
  const contentRevision = useContentRevisionStore((state) => state.revision);
  const queryKey = `${contentRevision}:${language}`;
  const [requestVersion, setRequestVersion] = useState(0);
  const [state, setState] = useState<ProgramFacetsState>({
    queryKey: '',
    cities: [],
    languages: [],
    loading: false,
    error: null,
  });
  const generation = useRef(0);
  const loadedQueryKey = useRef('');
  const failedQueryKey = useRef('');

  useEffect(() => {
    if (!enabled || loadedQueryKey.current === queryKey || failedQueryKey.current === queryKey)
      return;
    const requestGeneration = ++generation.current;
    let active = true;
    void Promise.all([queryProgramCities(language), queryProgramLanguages(language)])
      .then(([cities, languages]) => {
        if (!active || generation.current !== requestGeneration) return;
        loadedQueryKey.current = queryKey;
        failedQueryKey.current = '';
        setState({
          queryKey,
          cities,
          languages,
          loading: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (!active || generation.current !== requestGeneration) return;
        loadedQueryKey.current = '';
        failedQueryKey.current = queryKey;
        setState({
          queryKey,
          cities: [],
          languages: [],
          loading: false,
          error: toError(error),
        });
      });
    return () => {
      active = false;
    };
  }, [enabled, language, queryKey, requestVersion]);

  const retry = useCallback(() => {
    loadedQueryKey.current = '';
    failedQueryKey.current = '';
    setState((current) =>
      current.queryKey === queryKey
        ? { ...current, cities: [], languages: [], loading: true, error: null }
        : current,
    );
    setRequestVersion((version) => version + 1);
  }, [queryKey]);
  if (state.queryKey !== queryKey) {
    return {
      cities: [],
      languages: [],
      loading: enabled,
      error: null,
      retry,
    };
  }
  return { ...state, retry };
}
