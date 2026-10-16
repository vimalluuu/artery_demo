import { useCallback, useEffect, useState } from "react";

// The loader must be stable (a module function or useCallback).
export function useRemote(loader) {
  const [state, setState] = useState({
    data: null,
    loading: true,
    error: null,
  });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(() => {
        if (!active) return;
        setState({ data: null, loading: true, error: null });
        return loader();
      })
      .then((data) => {
        if (active) setState({ data, loading: false, error: null });
      })
      .catch((error) => {
        if (active) setState({ data: null, loading: false, error });
      });
    return () => {
      active = false;
    };
  }, [loader, revision]);
  return { ...state, reload };
}
