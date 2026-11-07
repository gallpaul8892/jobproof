import { screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { DEFAULT_THEME, type User } from "@jobproof/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { mockApi, problem, renderApp } from "../test/mockApi";
import { useDocumentTitle } from "../components/ui";
import { LoginPage } from "../pages/Login";
import { BRANDING_KEY } from "../theme/brandingCache";
import { Shell } from "./Shell";

const branding = { company_name: "Oak Ltd", theme: { ...DEFAULT_THEME } };
const user = (role: User["role"]): User => ({ id: "1", email: "a@b.c", full_name: "Tom Ashworth", role }) as User;

function Titled() {
  useDocumentTitle("Reports");
  return <p>page</p>;
}

beforeEach(() => {
  localStorage.clear();
  document.title = "Loading";
});

describe("Shell", () => {
  it("shows the company name and only Settings for an admin", async () => {
    mockApi(() => ({ body: branding }));
    renderApp(<Shell user={user("admin")} />, { branding: true });
    await waitFor(() => expect(screen.getByTestId("brand-name").textContent).toBe("Oak Ltd"));
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(Array.from(nav.querySelectorAll("a")).map((a) => a.textContent)).toEqual(["Settings"]);
    expect(screen.getByRole("link", { name: "Oak Ltd" }).getAttribute("href")).toBe("/settings");
  });

  it("shows the manager pages for a manager", async () => {
    mockApi(() => ({ body: branding }));
    renderApp(<Shell user={user("manager")} />, { branding: true });
    await screen.findByText("Oak Ltd");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(Array.from(nav.querySelectorAll("a")).map((a) => a.textContent)).toEqual(["Dashboard", "Reports", "Billing"]);
  });

  it("leaves the brand empty (and hidden) until the name is known", async () => {
    mockApi(() => new Promise(() => undefined));
    renderApp(<Shell user={user("manager")} />, { branding: true });
    const brand = screen.getByTestId("brand-name");
    expect(brand.textContent).toBe("");
    expect(brand.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("document title", () => {
  it("is 'Page | Company' once known and plain 'Page' before", async () => {
    mockApi(() => ({ body: { ...branding, company_name: "<b>Oak</b> & Sons" } }));
    renderApp(<Titled />, { branding: true });
    expect(document.title).toBe("Reports");
    await waitFor(() => expect(document.title).toBe("Reports | <b>Oak</b> & Sons"));
  });

  it("uses a stored snapshot straight away", () => {
    localStorage.setItem(BRANDING_KEY, JSON.stringify(branding));
    mockApi(() => new Promise(() => undefined));
    renderApp(<Titled />, { branding: true });
    expect(document.title).toBe("Reports | Oak Ltd");
  });
});

describe("Login heading", () => {
  const renderLogin = () =>
    renderApp(
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>,
      { branding: true },
    );

  it("is empty while loading, then the company name", async () => {
    mockApi(({ path }) => (path.endsWith("/branding") ? { body: branding } : problem(404, "not_found")));
    renderLogin();
    expect(screen.getByTestId("login-heading").textContent).toBe("");
    await waitFor(() => expect(screen.getByTestId("login-heading").textContent).toBe("Oak Ltd"));
    expect(document.body.textContent).not.toContain("JobProof");
  });

  it("falls back to 'Sign in' when branding fails", async () => {
    mockApi(() => problem(500, "internal_error"));
    renderLogin();
    await waitFor(() => expect(screen.getByTestId("login-heading").textContent).toBe("Sign in"));
  });
});
