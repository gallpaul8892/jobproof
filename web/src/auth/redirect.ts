/** Only same-site absolute paths may be used as a post-login target (no open redirect). */
export function safeRedirect(from: string | null | undefined): string {
  if (!from || !from.startsWith("/") || from.startsWith("//") || from.startsWith("/\\")) return "/";
  if (from.startsWith("/login")) return "/";
  return from;
}

export function loginUrl(from: string, expired = false): string {
  const params = new URLSearchParams();
  if (from && from !== "/" && !from.startsWith("/login")) params.set("from", from);
  if (expired) params.set("expired", "1");
  const qs = params.toString();
  return qs ? `/login?${qs}` : "/login";
}
