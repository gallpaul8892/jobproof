import { useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useLogout, type User } from "@jobproof/shared";

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <i style={{ background: "#e9b44c" }} />
      <i style={{ background: "#c8603a" }} />
      <i style={{ background: "#5f8f8b" }} />
      <i style={{ background: "#f4f1ea" }} />
    </span>
  );
}

export function Shell({ user }: { user: User }) {
  const logout = useLogout();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);

  // Move focus to the content when the page changes, so keyboard and screen reader users
  // start at the new page. Not on first load, and not for query-string changes.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    main.current?.focus({ preventScroll: true });
  }, [pathname]);

  async function signOut() {
    await logout();
    void navigate("/login", { replace: true });
  }

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand" aria-label="JobProof home">
            <BrandMark />
            <span className="brand-name">JobProof</span>
          </NavLink>
          <nav className="mainnav" aria-label="Main">
            <NavLink to="/" end>
              Dashboard
            </NavLink>
            <NavLink to="/reports">Reports</NavLink>
            <NavLink to="/billing">Billing</NavLink>
          </nav>
          <div className="userbox">
            <span className="user-name" data-testid="user-name">
              {user.full_name}
            </span>
            <button type="button" className="btn btn-ghost" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main id="main" ref={main} tabIndex={-1} className="content">
        <Outlet />
      </main>
    </div>
  );
}
