import { Navigate, Outlet, useLocation } from "react-router";
import { useMe, type Role } from "@jobproof/shared";
import { currentToken } from "../auth/sessionTokenStore";
import { loginUrl } from "../auth/redirect";
import { ErrorState, Loading } from "../components/QueryBoundary";
import { useDocumentTitle } from "../components/ui";
import { Shell } from "./Shell";

export function FullPageLoading() {
  useDocumentTitle("Loading");
  return (
    <main className="fullpage" id="main">
      <h1 className="sr-only">Loading</h1>
      <Loading what="your account" rows={2} />
    </main>
  );
}

/**
 * Area for one role. Nothing under it mounts (so no request for that area is made) until
 * /auth/me has answered with the matching role; anyone else goes to /not-authorised.
 */
export function RequireRole({ role }: { role: Role }) {
  const location = useLocation();
  const token = currentToken();
  const me = useMe(token !== null);

  if (token === null) {
    return <Navigate to={loginUrl(location.pathname + location.search)} replace />;
  }
  if (me.data === undefined) {
    if (me.isError) {
      return (
        <main className="fullpage" id="main">
          <h1 className="sr-only">Something went wrong</h1>
          <ErrorState what="your account" error={me.error} onRetry={() => void me.refetch()} busy={me.isFetching} />
        </main>
      );
    }
    return <FullPageLoading />;
  }
  if (me.data.role !== role) return <Navigate to="/not-authorised" replace />;
  return <Shell user={me.data} />;
}

export { Outlet };
