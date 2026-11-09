import type { OperativeJob, OperativeJobList, User } from "@jobproof/shared";
import { DAN, PRIYA, json, problemResponse } from "./helpers";

export const MANAGER: User = { id: "33333333-3333-4333-8333-333333333333", email: "manager@jobproof.test", full_name: "Mia Manager", role: "manager" } as User;
export const ADMIN: User = { id: "44444444-4444-4444-8444-444444444444", email: "admin@jobproof.test", full_name: "Alex Admin", role: "admin" } as User;

const STATUS = { server_time: "2026-11-09T09:00:00.000Z", api_version: "0.6.0", min_supported_versions: { android: "0.0.0" } };
const BRANDING = {
  company_name: "Test Services",
  theme: { primary: "#003366", accent: "#1F4E79", background: "#FFFFFF", surface: "#F2F5F8", text: "#101820" },
  uk_only_contact_details: true,
};

const ACCOUNTS: Record<string, { password: string; user: User }> = {
  [DAN.email]: { password: "Painter123!", user: DAN },
  [PRIYA.email]: { password: "Priya123!", user: PRIYA },
  [MANAGER.email]: { password: "Manager123!", user: MANAGER },
  [ADMIN.email]: { password: "Admin123!", user: ADMIN },
};

interface ServerSession {
  user: User;
  device: string;
  refresh: string;
  access: string;
  revoked: boolean;
}

/** Just enough of the API for the session flows. Everything it was asked is in `requests`. */
export function fakeServer() {
  const sessions = new Map<string, ServerSession>();
  const deactivated = new Set<string>();
  const operative = {
    list: { as_of: "2026-11-09T07:42:00Z", today: "2026-11-09", jobs_today: [], earlier_unfinished: [] } as OperativeJobList,
    /** Every job Dan may open, by id. Anything else is a 404, like another operative's job. */
    jobs: new Map<string, OperativeJob>(),
    /** When set, the list and detail answer with this status instead. */
    failWith: undefined as number | undefined,
    /** Resolves when the list is allowed to answer (to hold a request in flight). */
    hold: undefined as Promise<void> | undefined,
  };
  const requests: { method: string; path: string; body?: unknown }[] = [];
  let counter = 0;
  const server = {
    sessions,
    requests,
    operative,
    /** Sets today's list and makes every job in it openable. */
    setJobs: (list: Partial<OperativeJobList>) => {
      operative.list = { ...operative.list, ...list };
      operative.jobs.clear();
      for (const j of [...operative.list.jobs_today, ...operative.list.earlier_unfinished]) operative.jobs.set(j.id, j);
    },
    offline: false,
    /** A session that already exists on the server, as left behind by an earlier run of the app. */
    seedSession: (user: User, device: string): string => {
      counter += 1;
      const s: ServerSession = { user, device, refresh: `refresh-${counter}-`.padEnd(40, "z"), access: `access-${counter}`, revoked: false };
      sessions.set(s.refresh, s);
      return s.refresh;
    },
    deactivate: (user: User) => void deactivated.add(user.id),
    sessionRows: () => [...sessions.values()],
    fetch: async (input: RequestInfo | URL): Promise<Response> => {
      if (server.offline) throw new TypeError("Network request failed");
      const request = input as Request;
      const path = new URL(request.url).pathname.replace("/api/v1", "");
      const body = request.method === "POST" ? await request.clone().json().catch(() => undefined) : undefined;
      requests.push({ method: request.method, path, body });
      const bearer = request.headers.get("Authorization")?.replace("Bearer ", "");
      if (path === "/app/status") return json(STATUS);
      if (path === "/branding") return json(BRANDING);
      if (path === "/auth/sessions" && request.method === "POST") {
        const account = ACCOUNTS[(body as { email: string }).email];
        if (!account || account.password !== (body as { password: string }).password || deactivated.has(account.user.id)) {
          return problemResponse(401, "invalid_credentials");
        }
        if (account.user.role !== "painter") return problemResponse(403, "operatives_only");
        counter += 1;
        const s: ServerSession = { user: account.user, device: (body as { device_id: string }).device_id, refresh: `refresh-${counter}-`.padEnd(40, "z"), access: `access-${counter}`, revoked: false };
        for (const old of sessions.values()) if (old.user.id === s.user.id && old.device === s.device) old.revoked = true;
        sessions.set(s.refresh, s);
        return json(issue(s), 201);
      }
      if (path === "/auth/sessions/refresh") {
        const s = sessions.get((body as { refresh_token: string }).refresh_token);
        if (!s || s.revoked) return problemResponse(401, "session_ended");
        if (deactivated.has(s.user.id)) {
          s.revoked = true;
          return problemResponse(401, "account_inactive");
        }
        counter += 1;
        sessions.delete(s.refresh);
        s.revoked = false;
        s.refresh = `refresh-${counter}-`.padEnd(40, "z");
        s.access = `access-${counter}`;
        sessions.set(s.refresh, s);
        return json(issue(s));
      }
      const owner = [...sessions.values()].find((s) => s.access === bearer);
      if (!owner || owner.revoked) return problemResponse(401, "session_ended");
      if (deactivated.has(owner.user.id)) return problemResponse(401, "account_inactive");
      if (path === "/auth/sessions/current") {
        owner.revoked = true;
        return new Response(null, { status: 204 });
      }
      if (path === "/auth/me" || path === "/me") return json(owner.user);
      if (path.startsWith("/operative/jobs") && request.method === "GET") {
        if (operative.hold) await operative.hold;
        if (operative.failWith) return problemResponse(operative.failWith, operative.failWith === 404 ? "not_found" : "server_error");
        if (path === "/operative/jobs") return json(operative.list);
        const job = operative.jobs.get(path.slice("/operative/jobs/".length));
        return job ? json(job) : problemResponse(404, "not_found");
      }
      return problemResponse(404, "not_found");
    },
  };
  function issue(s: ServerSession) {
    return {
      access_token: s.access,
      token_type: "bearer",
      expires_in: 900,
      refresh_token: s.refresh,
      refresh_expires_at: "2027-01-01T00:00:00Z",
      session_id: "7b0d8f2e-3c3a-4d57-9c53-0a1b2c3d4e5f",
      user: s.user,
    };
  }
  return server;
}
