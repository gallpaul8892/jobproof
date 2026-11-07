import { request } from "@playwright/test";
import { API_URL, ADMIN, DEFAULT_NAME, DEFAULT_THEME_COLOURS } from "./support-constants";

/** Puts the company settings back to the defaults before a run (a crashed earlier run may have left changes). */
export default async function globalSetup(): Promise<void> {
  const api = await request.newContext();
  try {
    const login = await api.post(`${API_URL}/api/v1/auth/login`, { data: { email: ADMIN.email, password: ADMIN.password } });
    if (!login.ok()) throw new Error(`global setup: admin sign-in failed (${login.status()})`);
    const { access_token } = (await login.json()) as { access_token: string };
    const res = await api.patch(`${API_URL}/api/v1/admin/settings`, {
      headers: { Authorization: `Bearer ${access_token}` },
      data: { company_name: DEFAULT_NAME, theme: DEFAULT_THEME_COLOURS },
    });
    if (!res.ok()) throw new Error(`global setup: restoring default settings failed (${res.status()})`);
  } finally {
    await api.dispose();
  }
}
