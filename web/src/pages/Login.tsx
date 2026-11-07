import { useRef, useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { useQueryParams } from "../app/useQueryParams";
import { ApiError, useDemoAccounts, useLogin, useMe, type DemoAccount } from "@jobproof/shared";
import { currentToken } from "../auth/sessionTokenStore";
import { safeRedirect } from "../auth/redirect";
import { BrandMark } from "../app/Shell";
import { FullPageLoading } from "../app/guards";
import { useDocumentTitle } from "../components/ui";

function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Email or password is incorrect.";
    if (error.status === 0) return "Can't reach the server. Check it is running and try again.";
  }
  return "Something went wrong signing you in. Please try again.";
}

function DemoAccounts({ onUse }: { onUse: (account: DemoAccount) => void }) {
  const demo = useDemoAccounts();
  if (!demo.data || demo.data.length === 0) return null;
  return (
    <section className="demo" aria-labelledby="demo-heading" data-testid="demo-accounts">
      <h2 id="demo-heading">Demo accounts</h2>
      <p className="muted small">Local demo data only. Pick one to fill in the form.</p>
      <ul className="demo-list">
        {demo.data.map((a) => (
          <li key={a.email} data-testid={`demo-account-${a.role}`}>
            <div>
              <span className="demo-role">{a.role === "manager" ? "Manager" : "Painter"}</span>
              <span className="demo-name">{a.full_name}</span>
              <code>{a.email}</code>
              <code>{a.password}</code>
            </div>
            <button type="button" className="btn" onClick={() => onUse(a)}>
              Use<span className="sr-only"> {a.role} account</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LoginPage() {
  useDocumentTitle("Sign in");
  const [params] = useQueryParams();
  const token = currentToken();
  const me = useMe(token !== null);
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // Already signed in (page reload, or just signed in): go where they were heading.
  if (token !== null && me.isPending) return <FullPageLoading />;
  if (token !== null && me.data) {
    const target = me.data.role === "manager" ? safeRedirect(params.get("from")) : "/not-authorised";
    return <Navigate to={target} replace />;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (login.isPending) return;
    login.mutate(
      { email: email.trim(), password },
      {
        onError: () => {
          setPassword("");
          passwordRef.current?.focus();
        },
      },
    );
  }

  const expired = params.get("expired") === "1";

  return (
    <main className="login" id="main">
      <div className="login-card">
        <div className="brand brand-dark">
          <BrandMark />
          <span className="brand-name">JobProof</span>
        </div>
        <h1>Sign in</h1>
        <p className="muted">Head-office manager access to job reports and billing.</p>

        {expired && !login.isError && (
          <p className="notice" role="status" data-testid="session-expired">
            Your session has expired. Please sign in again.
          </p>
        )}
        {login.isError && (
          <p className="alert" role="alert" data-testid="login-error">
            {loginErrorMessage(login.error)}
          </p>
        )}

        <form onSubmit={submit} className="form" noValidate>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              ref={emailRef}
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              ref={passwordRef}
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={login.isPending}>
            {login.isPending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <DemoAccounts
          onUse={(a) => {
            setEmail(a.email);
            setPassword(a.password);
            login.reset();
            emailRef.current?.focus();
          }}
        />
      </div>
    </main>
  );
}
