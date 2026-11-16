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
    const { layer } = installFrame("/jobproof/");
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

describe("fillSignIn", () => {
  const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;

  it("types the login into the sign-in fields with real input events (what React listens to)", () => {
    document.getElementById("root")!.innerHTML = '<input data-testid="sign-in-email" /><input data-testid="sign-in-password" type="password" />';
    const seen: string[] = [];
    for (const id of ["sign-in-email", "sign-in-password"]) q(id).addEventListener("input", (e) => seen.push(`${id}=${(e.target as HTMLInputElement).value}`));
    expect(fillSignIn(LOGINS[1]!)).toBe(true);
    expect((q("sign-in-email") as HTMLInputElement).value).toBe("bo@b.test");
    expect((q("sign-in-password") as HTMLInputElement).value).toBe("pw2");
    expect(seen).toEqual(["sign-in-email=bo@b.test", "sign-in-password=pw2"]);
  });

  it("changes nothing, and says so, when the sign-in screen is not showing", () => {
    expect(fillSignIn(LOGINS[0]!)).toBe(false);
  });

  it("has no side panel any more: the logins live in the app's sign-in screen", () => {
    installFrame("/");
    expect(document.querySelector('[data-testid="demo-logins"]')).toBeNull();
    expect(document.head.querySelector("style[data-demo-frame]")!.textContent).not.toContain("demo-logins");
  });
});
