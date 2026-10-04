import { useCallback, useEffect, useRef, useState } from 'react';

export interface PaginatedList<T> {
  items: T[];
  total: number;
  page: number;
  hasMore: boolean;
  /** Initial (first-ever) load — true only until the first response lands. */
  loading: boolean;
  /** Pull-to-refresh in flight (keeps existing items visible). */
  refreshing: boolean;
  /** Next page in flight. */
  loadingMore: boolean;
  error: string | null;
  refresh: () => void;
  loadMore: () => void;
}

interface FetchPageResult<T> {
  items: T[];
  total: number;
}

function toMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong';
}

/**
 * Race-safe paginated list (spec §3.3 hook pattern):
 *  - every request bumps a counter; a stale response can never overwrite the
 *    latest one (this is what used to turn "back from detail" into an empty
 *    list / spinner, A-7/A-9),
 *  - `deps` reloads first page when filters change (previous items stay
 *    visible until replacement arrives — no flash-of-skeleton),
 *  - no synchronous setState inside the effect (lint-clean by construction).
 */
export function usePaginatedList<T>(
  fetchPage: (page: number) => Promise<FetchPageResult<T>>,
  deps: React.DependencyList,
): PaginatedList<T> {
  const [state, setState] = useState<{
    items: T[];
    total: number;
    page: number;
    loading: boolean;
    refreshing: boolean;
    loadingMore: boolean;
    error: string | null;
  }>({
    items: [],
    total: 0,
    page: 0,
    loading: true,
    refreshing: false,
    loadingMore: false,
    error: null,
  });

  const requestIdRef = useRef(0);
  const pageRef = useRef(0);
  // Always call the latest fetcher (callers pass inline closures) without
  // re-running the load effect on every render.
  const fetchRef = useRef(fetchPage);

  useEffect(() => {
    fetchRef.current = fetchPage;
  });

  const loadPage = useCallback(
    async (mode: 'first' | 'refresh' | 'more', setLoadingState: boolean) => {
      const id = ++requestIdRef.current;
      const targetPage = mode === 'more' ? pageRef.current + 1 : 1;
      if (setLoadingState) {
        // Only ever called from event handlers (refresh/loadMore buttons,
        // pull-to-refresh) — never from the mount effect.
        setState((s) => ({
          ...s,
          refreshing: mode === 'refresh',
          loadingMore: mode === 'more',
          error: null,
        }));
      }
      try {
        const res = await fetchRef.current(targetPage);
        if (id !== requestIdRef.current) return; // stale — a newer request won
        pageRef.current = targetPage;
        setState((s) => ({
          items: mode === 'more' ? [...s.items, ...res.items] : res.items,
          total: res.total,
          page: targetPage,
          loading: false,
          refreshing: false,
          loadingMore: false,
          error: null,
        }));
      } catch (err) {
        if (id !== requestIdRef.current) return;
        setState((s) => ({
          ...s,
          loading: false,
          refreshing: false,
          loadingMore: false,
          error: toMessage(err),
        }));
      }
    },
    [],
  );

  // First page for the current filter set. All setState happens after await.
  useEffect(() => {
    pageRef.current = 0;
    void loadPage('first', false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps forwarded by the caller
  }, deps);

  const refresh = useCallback(() => {
    void loadPage('refresh', true);
  }, [loadPage]);

  const loadMore = useCallback(() => {
    void loadPage('more', true);
  }, [loadPage]);

  const guardedLoadMore = useCallback(() => {
    if (state.loading || state.refreshing || state.loadingMore) return;
    if (state.error) return;
    if (state.items.length >= state.total) return;
    loadMore();
  }, [state.loading, state.refreshing, state.loadingMore, state.error, state.items.length, state.total, loadMore]);

  return {
    items: state.items,
    total: state.total,
    page: state.page,
    hasMore: state.items.length < state.total,
    loading: state.loading,
    refreshing: state.refreshing,
    loadingMore: state.loadingMore,
    error: state.error,
    refresh,
    loadMore: guardedLoadMore,
  };
}
