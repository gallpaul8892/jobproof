import { useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useLogout, type User } from "@jobproof/shared";
import { useCompanyName } from "../theme/BrandingProvider";
import { homeFor } from "./roles";

/** The company name as the brand. Empty (but keeps its width) until the name is known. */
export function BrandName() {
  const name = useCompanyName();
  return name ? (
    <span className="brand-name" data-testid="brand-name">
      {name}
    </span>
  ) : (
    <span className="brand-name brand-name-pending" data-testid="brand-name" aria-hidden="true" />
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
          <NavLink to={homeFor(user.role)} className="brand">
            <BrandName />
          </NavLink>
          <nav className="mainnav" aria-label="Main">
            {user.role === "admin" ? (
              <NavLink to="/settings">Settings</NavLink>
            ) : (
              <>
                <NavLink to="/" end>
                  Dashboard
                </NavLink>
                <NavLink to="/reports">Reports</NavLink>
                <NavLink to="/billing">Billing</NavLink>
              </>
            )}
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
