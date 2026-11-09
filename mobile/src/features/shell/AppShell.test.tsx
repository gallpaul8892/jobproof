import { Text } from "react-native";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { configureApiClient, DEFAULT_THEME } from "@jobproof/shared";
import type { QueryClient } from "@tanstack/react-query";
import { createQueryClient } from "../../api/queryClient";
import { BRANDING_KEY } from "../../theme/brandingStore";
import { AppShell } from "./AppShell";
import { UNREACHABLE_MESSAGE } from "./Unreachable";

const kv = () => (globalThis as unknown as { __kvStore: Map<string, string> }).__kvStore;

const STATUS = { server_time: "2026-11-09T09:00:00.000Z", api_version: "0.6.0", min_supported_versions: { android: "0.0.0" } };
const BRANDING = {
  company_name: "Arbour Services",
  theme: { primary: "#003366", accent: "#1F4E79", background: "#FFFFFF", surface: "#F2F5F8", text: "#101820" },
  uk_only_contact_details: true,
};

type Handler = () => Response | Promise<Response>;
function api(routes: { status?: Handler; branding?: Handler }) {
  const calls: string[] = [];
  configureApiClient({
    baseUrl: "http://api.test",
    fetch: async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push(url);
      const handler = url.endsWith("/api/v1/app/status") ? routes.status : url.endsWith("/branding") ? routes.branding : undefined;
      if (!handler) throw new TypeError("Network request failed");
      return handler();
    },
  });
  return calls;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const offline = () => {
  throw new TypeError("Network request failed");
};

const clients: QueryClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((c) => c.clear()); // cancels gc timers so Jest can exit
});

async function renderShell() {
  const client = createQueryClient();
  clients.push(client);
  return await render(
    <AppShell client={client}>
      <Text testID="child">child</Text>
    </AppShell>,
  );
}

const titleColour = () => {
  const header = screen.getByTestId("app-header");
  return { bg: (header.props.style as { backgroundColor: string }[]).flat().find((s) => s?.backgroundColor)?.backgroundColor };
};

describe("AppShell branding (scenarios 2 to 4)", () => {
  it("shows the company name in white on the primary colour", async () => {
    api({ status: () => json(STATUS), branding: () => json(BRANDING) });
    await renderShell();
    await waitFor(() => expect(screen.getByTestId("app-header-title").props.children).toBe("Arbour Services"));
    expect(titleColour().bg).toBe("#003366");
    expect(screen.getByTestId("app-header-title").props.style).toEqual(expect.arrayContaining([expect.objectContaining({ color: "white" })]));
    expect(await screen.findByTestId("child")).toBeTruthy();
  });

  it("stores the server answer and uses it with no signal later (scenario 4)", async () => {
    api({ status: () => json(STATUS), branding: () => json(BRANDING) });
    const first = await renderShell();
    await waitFor(() => expect(kv().get(BRANDING_KEY)).toContain("Arbour Services"));
    await first.unmount();

    api({ status: () => json(STATUS), branding: offline });
    await renderShell();
    expect(screen.getByTestId("app-header-title").props.children).toBe("Arbour Services");
    expect(titleColour().bg).toBe("#003366");
    await screen.findByTestId("child");
    expect(screen.getByTestId("app-header-title").props.children).toBe("Arbour Services");
  });

  it("applies a changed colour after the refetch (scenario 2)", async () => {
    kv().set(BRANDING_KEY, JSON.stringify(BRANDING));
    api({ status: () => json(STATUS), branding: () => json({ ...BRANDING, theme: { ...BRANDING.theme, primary: "#7A1F1F" } }) });
    await renderShell();
    await waitFor(() => expect(titleColour().bg).toBe("#7A1F1F"));
  });

  it("first launch with no snapshot and no branding: default theme and neutral heading, no error screen (scenario 3)", async () => {
    api({ status: () => json(STATUS), branding: offline });
    await renderShell();
    await screen.findByTestId("child");
    expect(screen.getByTestId("app-header-title").props.children).toBe("Sign in");
    expect(titleColour().bg).toBe(DEFAULT_THEME.primary);
    expect(screen.queryByTestId("unreachable")).toBeNull();
  });

  it("ignores a corrupt snapshot", async () => {
    kv().set(BRANDING_KEY, "{not json");
    api({ status: () => json(STATUS), branding: offline });
    await renderShell();
    await screen.findByTestId("child");
    expect(screen.getByTestId("app-header-title").props.children).toBe("Sign in");
    expect(kv().has(BRANDING_KEY)).toBe(false);
  });
});

describe("AppShell reachability (scenario 7)", () => {
  it("shows the message and Retry when the server cannot be reached, never a blank screen", async () => {
    api({ status: offline, branding: offline });
    await renderShell();
    expect(await screen.findByText(UNREACHABLE_MESSAGE)).toBeTruthy();
    expect(screen.getByTestId("app-header")).toBeTruthy();
    expect(screen.queryByTestId("child")).toBeNull();
  });

  it("Retry asks the server again and continues when it answers", async () => {
    let up = false;
    const calls = api({ status: () => (up ? json(STATUS) : offline()), branding: offline });
    await renderShell();
    await screen.findByText(UNREACHABLE_MESSAGE);
    const before = calls.filter((u) => u.endsWith("/app/status")).length;
    up = true;
    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("child")).toBeTruthy();
    expect(calls.filter((u) => u.endsWith("/app/status")).length).toBe(before + 1);
  });

  it("treats a wrong server (an HTTP error) like an unreachable one", async () => {
    api({ status: () => json({ title: "Not found", status: 404, code: "not_found" }, 404), branding: offline });
    await renderShell();
    expect(await screen.findByText(UNREACHABLE_MESSAGE)).toBeTruthy();
  });
});
