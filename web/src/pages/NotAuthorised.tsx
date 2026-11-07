import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { useLogout, useMe, type Role } from "@jobproof/shared";
import { currentToken } from "../auth/sessionTokenStore";
import { loginUrl } from "../auth/redirect";
import { BrandName } from "../app/Shell";
import { FullPageLoading } from "../app/guards";
import { useDocumentTitle } from "../components/ui";

function Message({ role, name }: { role: Role; name: string }) {
  if (role === "admin") {
    return (
      <>
        <h1>This page is for managers</h1>
        <p>
          You are signed in as {name}, an administrator. This page is for managers.{" "}
          <Link to="/settings">Go to Settings</Link>.
        </p>
      </>
    );
  }
  if (role === "manager") {
    return (
      <>
        <h1>This page is for administrators</h1>
        <p>
          You are signed in as {name}, a manager. Only administrators can change company settings.{" "}
          <Link to="/">Go to the dashboard</Link>.
        </p>
      </>
    );
  }
  return (
    <>
      <h1>This app is for head-office managers</h1>
      <p>
        You are signed in as {name}, a painter. Managers review job reports and billing here. Painters use the
        mobile app, so there is nothing for you to see on this site.
      </p>
    </>
  );
}

export function NotAuthorisedPage() {
  useDocumentTitle("Not authorised");
  const location = useLocation();
  const navigate = useNavigate();
  const logout = useLogout();
  const token = currentToken();
  const me = useMe(token !== null);

  if (token === null) return <Navigate to={loginUrl(location.pathname)} replace />;
  if (me.data === undefined) return me.isError ? <Navigate to="/login" replace /> : <FullPageLoading />;

  return (
    <main className="fullpage" id="main">
      <section className="panel narrow" data-testid="not-authorised">
        <div className="brand-dark">
          <BrandName />
        </div>
        <Message role={me.data.role} name={me.data.full_name} />
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
