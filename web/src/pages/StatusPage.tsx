import { ApiError, useHealth } from "@jobproof/shared";

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.status === 0 ? error.title : `${error.title} (HTTP ${error.status})`;
  }
  return "Something went wrong";
}

export function StatusPage() {
  const health = useHealth();

  return (
    <main className="page">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true">
          ✓
        </span>
        <h1>JobProof</h1>
      </header>
      <section className="card" aria-labelledby="status-heading">
        <h2 id="status-heading">System status</h2>
        {health.isPending && (
          <p className="status status-loading" data-testid="api-status" role="status">
            API: checking…
          </p>
        )}
        {health.isSuccess && (
          <div role="status">
            <p className="status status-ok" data-testid="api-status">
              API: {health.data.status}
            </p>
            <p className="muted" data-testid="api-detail">
              Database: {health.data.database} · Version {health.data.version}
            </p>
          </div>
        )}
        {health.isError && (
          <div role="alert">
            <p className="status status-error" data-testid="api-status">
              API: unavailable
            </p>
            <p className="muted" data-testid="api-error">
              {describeError(health.error)}
            </p>
            <button
              type="button"
              className="button"
              data-testid="retry"
              onClick={() => void health.refetch()}
              disabled={health.isFetching}
            >
              Try again
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
