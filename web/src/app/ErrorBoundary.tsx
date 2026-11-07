import { Component, type ReactNode } from "react";

export function CrashFallback() {
  return (
    <main className="fullpage" id="main">
      <section className="panel narrow" role="alert">
        <h1>Something went wrong</h1>
        <p>The page hit an unexpected problem. Reloading usually fixes it.</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </section>
    </main>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <CrashFallback /> : this.props.children;
  }
}
