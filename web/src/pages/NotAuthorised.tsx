import { Navigate, useLocation, useNavigate } from "react-router";
import { useLogout, useMe } from "@jobproof/shared";
import { currentToken } from "../auth/sessionTokenStore";
import { loginUrl } from "../auth/redirect";
import { BrandMark } from "../app/Shell";
import { FullPageLoading } from "../app/guards";
import { useDocumentTitle } from "../components/ui";

export function NotAuthorisedPage() {
  useDocumentTitle("Managers only");
  const location = useLocation();
  const navigate = useNavigate();
  const logout = useLogout();
  const token = currentToken();
  const me = useMe(token !== null);

  if (token === null) return <Navigate to={loginUrl(location.pathname)} replace />;
  if (me.data === undefined) return me.isError ? <Navigate to="/login" replace /> : <FullPageLoading />;
  if (me.data.role === "manager") return <Navigate to="/" replace />;

  return (
    <main className="fullpage" id="main">
      <section className="panel narrow" data-testid="not-authorised">
        <div className="brand brand-dark">
          <BrandMark />
          <span className="brand-name">JobProof</span>
        </div>
        <h1>This app is for head-office managers</h1>
        <p>
          You are signed in as {me.data.full_name}, a painter. Managers review job reports and billing
          here. Painters use the mobile app, so there is nothing for you to see on this site.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            void logout().then(() => navigate("/login", { replace: true }));
          }}
        >
          Sign out
        </button>
      </section>
    </main>
  );
}
