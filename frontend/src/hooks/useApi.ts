import { useCallback, useEffect, useState } from "react";
import { ApiError, api, SessionExpiredError } from "../api/client";

export type ApiState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
};

/**
 * Minimal GET hook. No data-fetching library yet — the shell has three screens,
 * and a game with real state will want its own store anyway.
 *
 * A `SessionExpiredError` is swallowed on purpose: `apiFetch` has already started
 * the single re-login navigation, so surfacing an error here would just flash a
 * failure message on a page that is about to be replaced.
 */
export function useApi<T>(path: string): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    api
      .get<T>(path)
      .then((result) => {
        if (!active) return;
        setData(result);
      })
      .catch((err: unknown) => {
        if (!active || err instanceof SessionExpiredError) return;
        setError(err instanceof ApiError ? err.message : "unexpected error");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [path, nonce]);

  return { data, error, loading, reload };
}
