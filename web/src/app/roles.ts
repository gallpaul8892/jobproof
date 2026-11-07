import type { Role } from "@jobproof/shared";

/** Where each role lands after sign-in and when the brand link is used. */
export function homeFor(role: Role): string {
  switch (role) {
    case "manager":
      return "/";
    case "admin":
      return "/settings";
    default:
      return "/not-authorised";
  }
}

/** The server enforces access; this only decides what the UI offers and where it redirects. */
export function canVisit(role: Role, pathname: string): boolean {
  const path = pathname.split(/[?#]/)[0] ?? "";
  if (role === "manager") {
    return path === "/" || path === "/reports" || path.startsWith("/reports/") || path === "/billing";
  }
  if (role === "admin") return path === "/settings";
  return false;
}
