import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from './api';

/** Carrega dados de forma assíncrona, com estado de carregamento, erro e recarga. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(loader, deps);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    return load()
      .then(setData)
      .catch((reason) => setError(errorMessage(reason)))
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}
