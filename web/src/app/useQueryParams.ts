import { useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";

/**
 * URL query state. Same shape as react-router's useSearchParams, which is not used because
 * its bundled warning text contains a URL that the dist origin check rejects.
 */
export function useQueryParams(): [URLSearchParams, (next: URLSearchParams, options?: { replace?: boolean }) => void] {
  const { search } = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const setParams = useCallback(
    (next: URLSearchParams, options?: { replace?: boolean }) => {
      void navigate({ search: next.toString() }, { replace: options?.replace });
    },
    [navigate],
  );
  return [params, setParams];
}
