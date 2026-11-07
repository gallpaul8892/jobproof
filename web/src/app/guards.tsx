import { Navigate, Outlet, useLocation } from "react-router";
import { useMe } from "@jobproof/shared";
import { currentToken } from "../auth/sessionTokenStore";
import { loginUrl } from "../auth/redirect";
import { ErrorState, Loading } from "../components/QueryBoundary";
import { useDocumentTitle } from "../components/ui";
import { Shell } from "./Shell";

export function FullPageLoading() {
  useDocumentTitle("Loading");
  return (
    <main className="fullpage" id="main">
      <h1 className="sr-only">JobProof</h1>
      <Loading what="your account" rows={2} />
    </main>
  );
}

/** Manager-only area. Nothing under it mounts (so no manager request is made) until the role is known. */
export function RequireManager() {
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
          <h1 className="sr-only">JobProof</h1>
          <ErrorState what="your account" error={me.error} onRetry={() => void me.refetch()} busy={me.isFetching} />
        </main>
      );
    }
    return <FullPageLoading />;
  }
  if (me.data.role !== "manager") return <Navigate to="/not-authorised" replace />;
  return <Shell user={me.data} />;
}

export { Outlet };
