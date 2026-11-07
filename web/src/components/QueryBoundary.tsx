import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { ApiError } from "@jobproof/shared";

export function Loading({ what, rows = 5 }: { what: string; rows?: number }) {
  return (
    <div className="loading" data-testid="loading-state" role="status">
      <p className="loading-text">Loading {what}…</p>
      <div className="skeleton-stack" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <div className="skeleton" key={i} />
        ))}
      </div>
    </div>
  );
}

export function ErrorState({
  what,
  error,
  onRetry,
  busy,
}: {
  what: string;
  error: unknown;
  onRetry: () => void;
  busy?: boolean;
}) {
  const api = error instanceof ApiError ? error : undefined;
  const network = !api || api.status === 0;
  return (
    <div className="state state-error" data-testid="error-state" role="alert">
      <h2 className="state-title">Something went wrong loading {what}.</h2>
      <p>
        {network
          ? "Can't reach the server. Check it is running and try again."
          : (api.detail ?? api.title)}
      </p>
      {api?.requestId && <p className="muted small">Ref: {api.requestId}</p>}
      <button type="button" className="btn btn-primary" data-testid="retry-button" onClick={onRetry} disabled={busy}>
        Try again
      </button>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state" data-testid="empty-state">
      <h2 className="state-title">{title}</h2>
      {children}
    </div>
  );
}

/**
 * One loading / error / data switch for every data view. While paging, previous data stays on
 * screen and the wrapper is marked busy.
 */
export function QueryBoundary<T>({
  query,
  what,
  skeletonRows,
  children,
}: {
  query: UseQueryResult<T, unknown>;
  what: string;
  skeletonRows?: number;
  children: (data: T) => ReactNode;
}) {
  if (query.data === undefined) {
    if (query.isError) {
      return (
        <ErrorState what={what} error={query.error} onRetry={() => void query.refetch()} busy={query.isFetching} />
      );
    }
    return <Loading what={what} rows={skeletonRows} />;
  }
  return (
    <div className="boundary" aria-busy={query.isFetching && query.isPlaceholderData}>
      {query.isError && (
        <ErrorState what={what} error={query.error} onRetry={() => void query.refetch()} busy={query.isFetching} />
      )}
      {children(query.data)}
    </div>
  );
}
