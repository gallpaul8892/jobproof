/** @jest-environment jsdom */
import { DEMO_NOTE, chooseSamples, fillSignIn, installFrame, overlayHost, resetFrameForTests } from "./frame";

const SAMPLES = [
  { id: "a", title: "Lounge" },
  { id: "b", title: "Hall" },
];

const LOGINS = [
  { name: "Ann One", email: "ann@b.test", password: "pw1" },
  { name: "Bo Two", email: "bo@b.test", password: "pw2" },
];

beforeEach(() => {
  resetFrameForTests();
  document.head.innerHTML = "";
  document.body.innerHTML = '<div id="root"><p>app</p></div>';
});

describe("phone frame", () => {
  it("wraps the app's root, shows the permanent note and links back to the landing page", () => {
    const { layer } = installFrame("/jobproof/", LOGINS);
    const phone = document.querySelector('[data-testid="demo-phone"]')!;
    expect(phone.contains(document.getElementById("root"))).toBe(true);
    expect(phone.contains(layer)).toBe(true);
    const note = document.querySelector('[data-testid="demo-note"]')!;
    expect(note.getAttribute("role")).toBe("status");
    expect(note.textContent).toContain(DEMO_NOTE);
    expect(DEMO_NOTE).toBe("Demo with sample data. Nothing is saved.");
    expect(note.querySelector("a")!.getAttribute("href")).toBe("/jobproof/");
    expect(document.head.querySelector("style[data-demo-frame]")!.textContent).toContain("390px");
    expect(document.head.querySelector("style[data-demo-frame]")!.textContent).toContain("844px");
    expect(document.head.querySelector("link[rel~='icon']")!.getAttribute("href")).toBe("data:,"); // no favicon request
  });

  it("is built only once, and overlays go into its layer", () => {
    const first = installFrame("/");
    expect(installFrame("/")).toBe(first);
    expect(document.querySelectorAll('[data-testid="demo-note"]')).toHaveLength(1);
    expect(overlayHost()).toBe(first.layer);
  });

  it("is full screen on a phone: the narrow-screen rule drops the bezel and the fixed size", () => {
    installFrame("/");
    const css = document.head.querySelector("style[data-demo-frame]")!.textContent!;
    expect(css).toMatch(/@media \(max-width: 480px\)[\s\S]*\.demo-phone[^}]*width: 100%[^}]*border: 0/);
  });
});

describe("sample photo chooser", () => {
  const open = () => {
    installFrame("/");
    return chooseSamples(SAMPLES, 5, () => "data:image/jpeg;base64,AAAA");
  };
  const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;

  it("returns the ticked samples, in list order, and closes", async () => {
    const result = open();
    expect(q("demo-sample-picker").getAttribute("role")).toBe("dialog");
    q("demo-sample-b").click();
    q("demo-sample-a").click();
    q("demo-sample-add").click();
    expect(await result).toEqual([0, 1]);
    expect(document.querySelector('[data-testid="demo-sample-picker"]')).toBeNull();
  });

  it("returns null when nothing is ticked, on Cancel, on a click outside and on Escape", async () => {
    let r = open();
    q("demo-sample-add").click();
    expect(await r).toBeNull();
    r = open();
    q("demo-sample-cancel").click();
    expect(await r).toBeNull();
    r = open();
    q("demo-sample-picker").click();
    expect(await r).toBeNull();
    r = open();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(await r).toBeNull();
  });

  it("never returns more than the limit", async () => {
    installFrame("/");
    const r = chooseSamples(SAMPLES, 1, () => "data:,");
    q("demo-sample-a").click();
    q("demo-sample-b").click();
    q("demo-sample-add").click();
    expect(await r).toEqual([0]);
  });
});

describe("demo logins panel", () => {
  const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
  // What react-native-web's TextInput renders: plain inputs carrying the testID, with React-style change listening.
  const signInScreen = () => {
    document.getElementById("root")!.innerHTML = '<input data-testid="sign-in-email" /><input data-testid="sign-in-password" type="password" />';
    const seen: string[] = [];
    for (const id of ["sign-in-email", "sign-in-password"]) q(id).addEventListener("input", (e) => seen.push(`${id}=${(e.target as HTMLInputElement).value}`));
    return seen;
  };

  it("lists every login with name, email and password, beside the phone, and has a button for each", () => {
    installFrame("/", LOGINS);
    const panel = q("demo-logins");
    expect(panel.closest('[data-testid="demo-stage"]')!.contains(q("demo-phone"))).toBe(true);
    expect(q("demo-login-0").textContent).toContain("Ann One");
    expect(q("demo-login-0").textContent).toContain("ann@b.test");
    expect(q("demo-login-0").textContent).toContain("pw1");
    expect(q("demo-login-1").textContent).toContain("bo@b.test");
    expect(q("demo-use-login-1").textContent).toBe("Use this login");
    expect(q("demo-logins-status").getAttribute("role")).toBe("status");
  });

  it("is collapsed on a narrow screen and open on a wide one, and collapses above the frame in CSS", () => {
    window.matchMedia = ((query: string) => ({ matches: query.includes("900px") })) as unknown as typeof window.matchMedia;
    installFrame("/", LOGINS);
    expect((q("demo-logins") as HTMLDetailsElement).open).toBe(false);
    expect(document.head.querySelector("style[data-demo-frame]")!.textContent).toMatch(/@media \(max-width: 900px\)[\s\S]*\.demo-logins[^}]*order: -1/);
    resetFrameForTests();
    document.body.innerHTML = '<div id="root"></div>';
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
    installFrame("/", LOGINS);
    expect((q("demo-logins") as HTMLDetailsElement).open).toBe(true);
    delete (window as unknown as Record<string, unknown>).matchMedia;
  });

  it("'Use this login' fills the sign-in email and password with that login only", () => {
    installFrame("/", LOGINS);
    const seen = signInScreen();
    q("demo-use-login-1").click();
    expect((q("sign-in-email") as HTMLInputElement).value).toBe("bo@b.test");
    expect((q("sign-in-password") as HTMLInputElement).value).toBe("pw2");
    expect(seen).toEqual(["sign-in-email=bo@b.test", "sign-in-password=pw2"]); // real input events, which is what React listens to
    expect(q("demo-logins-status").textContent).toContain("Bo Two");
    q("demo-use-login-0").click();
    expect((q("sign-in-email") as HTMLInputElement).value).toBe("ann@b.test");
    expect((q("sign-in-password") as HTMLInputElement).value).toBe("pw1");
  });

  it("says so, and changes nothing, when the sign-in screen is not showing", () => {
    installFrame("/", LOGINS);
    q("demo-use-login-0").click();
    expect(q("demo-logins-status").textContent).toMatch(/sign-in screen first/);
    expect(fillSignIn(LOGINS[0]!)).toBe(false);
  });

  it("has no panel when there are no logins", () => {
    installFrame("/");
    expect(document.querySelector('[data-testid="demo-logins"]')).toBeNull();
  });
});
