/**
 * Only same-site paths may be used as a post-login target (no open redirect). Browsers strip
 * tab, CR and LF when parsing URLs, so "/\t/evil.com" would become "//evil.com": any control
 * character or backslash anywhere in the value is refused, and the value must resolve to the
 * same origin. Returns path + query + hash, or "/" (the dashboard).
 */
export function safeRedirect(from: string | null | undefined, origin: string = window.location.origin): string {
  if (!from || !from.startsWith("/")) return "/";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(from)) return "/";
  try {
    const url = new URL(from, origin);
    if (url.origin !== origin) return "/";
    const target = url.pathname + url.search + url.hash;
    if (target.startsWith("//") || target.startsWith("/login")) return "/";
    return target;
  } catch {
    return "/";
  }
}

export function loginUrl(from: string, expired = false): string {
  const params = new URLSearchParams();
  if (from && from !== "/" && !from.startsWith("/login")) params.set("from", from);
  if (expired) params.set("expired", "1");
  const qs = params.toString();
  return qs ? `/login?${qs}` : "/login";
}
