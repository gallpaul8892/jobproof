import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, contrastRatio } from "@jobproof/shared";
import { THEME_PROPERTIES, applyTheme, safeTheme } from "./applyTheme";
import { BRANDING_KEY, parseSnapshot, readSnapshot, writeSnapshot } from "./brandingCache";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const css = readFileSync(join(here, "..", "styles", "app.css"), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === "generated") return [];
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe("hex colours live only where they are allowed", () => {
  const allowed = new Set(["shared/src/branding/defaults.ts", "shared/src/branding/presets.ts", "web/src/styles/app.css"]);
  const files = [...walk(join(root, "web", "src")), ...walk(join(root, "shared", "src"))].filter(
    (f) => /\.(ts|tsx|css)$/.test(f) && !/\.test\.tsx?$/.test(f),
  );

  it("scans a meaningful number of files", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("source files outside the allowed ones contain no hex colour", () => {
    const offences = files
      .filter((f) => !allowed.has(relative(root, f)))
      .filter((f) => /#[0-9a-fA-F]{3,8}\b/.test(readFileSync(f, "utf8").replace(/&#\d+;/g, "")))
      .map((f) => relative(root, f));
    expect(offences).toEqual([]);
  });

  it("app.css has hex codes only inside the neutral and status blocks", () => {
    const outside = css.replace(/\/\* tokens:neutral \*\/[\s\S]*?\/\* tokens:end \*\//, "");
    expect(outside.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  });

  it("app.css references the brand tokens and holds none of the default codes", () => {
    for (const token of Object.values(THEME_PROPERTIES)) expect(css).toContain(`var(${token})`);
    for (const code of Object.values(DEFAULT_THEME)) expect(css.toLowerCase()).not.toContain(code.toLowerCase());
    expect(css).not.toMatch(/<style|!important/);
  });
});

describe("contrast of the fixed colours", () => {
  const tokens = Object.fromEntries([...css.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1]!, m[2]!.toUpperCase()]));
  const white = "#FFFFFF";

  it("default theme pairs pass AA", () => {
    const t = DEFAULT_THEME;
    const pairs: [string, string][] = [
      [white, t.primary],
      [t.accent, t.background],
      [t.accent, t.surface],
      [t.text, t.background],
      [t.text, t.surface],
    ];
    for (const [a, b] of pairs) expect(contrastRatio(a, b), `${a}/${b}`).toBeGreaterThanOrEqual(4.5);
  });

  it("every status ink is at least 4.5:1 on its own background", () => {
    const tones = Object.keys(tokens).filter((k) => k.startsWith("--status-") && k.endsWith("-bg"));
    expect(tones.length).toBe(7);
    for (const bg of tones) {
      const ink = bg.replace(/-bg$/, "-ink");
      expect(contrastRatio(tokens[ink]!, tokens[bg]!), ink).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("muted text passes on white and on the default surface; control borders reach 3:1", () => {
    expect(contrastRatio(tokens["--muted"]!, white)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens["--muted"]!, DEFAULT_THEME.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens["--control-border"]!, white)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(tokens["--control-border"]!, DEFAULT_THEME.surface)).toBeGreaterThanOrEqual(3);
  });
});

describe("applyTheme", () => {
  it("sets the five custom properties through the CSSOM and creates no style element", () => {
    const root = document.createElement("div");
    const before = document.querySelectorAll("style").length;
    applyTheme({ ...DEFAULT_THEME, primary: "#1F3A5F", accent: "#2B4C7E" }, root);
    expect(root.style.getPropertyValue("--jp-primary")).toBe("#1F3A5F");
    expect(root.style.getPropertyValue("--jp-accent")).toBe("#2B4C7E");
    expect(root.style.getPropertyValue("--jp-bg")).toBe(DEFAULT_THEME.background);
    expect(root.style.getPropertyValue("--jp-surface")).toBe(DEFAULT_THEME.surface);
    expect(root.style.getPropertyValue("--jp-text")).toBe(DEFAULT_THEME.text);
    expect(document.querySelectorAll("style").length).toBe(before);
  });

  it("replaces anything that is not #RRGGBB with the default for that token", () => {
    const hostile = { primary: "red; background: url(x)", accent: "#abcdef", background: 5, surface: "#12345", text: undefined };
    expect(safeTheme(hostile)).toEqual(DEFAULT_THEME);
    const root = document.createElement("div");
    applyTheme(hostile, root);
    expect(root.style.getPropertyValue("--jp-primary")).toBe(DEFAULT_THEME.primary);
    expect(root.getAttribute("style")).not.toContain("url(");
  });
});

describe("branding snapshot", () => {
  const good = { company_name: "Oak Ltd", theme: { ...DEFAULT_THEME } };

  it("round-trips a valid snapshot", () => {
    localStorage.clear();
    writeSnapshot(good);
    expect(readSnapshot()).toEqual(good);
  });

  it("ignores and removes an invalid snapshot", () => {
    const bad = [
      "not json",
      "null",
      JSON.stringify({ ...good, company_name: "" }),
      JSON.stringify({ ...good, company_name: "x".repeat(61) }),
      JSON.stringify({ ...good, company_name: "a\nb" }),
      JSON.stringify({ ...good, theme: { ...good.theme, primary: "red" } }),
      JSON.stringify({ ...good, theme: { ...good.theme, accent: "#1f5130" } }),
      JSON.stringify({ company_name: "Oak" }),
    ];
    for (const raw of bad) {
      expect(parseSnapshot(raw), raw).toBeUndefined();
      localStorage.setItem(BRANDING_KEY, raw);
      expect(readSnapshot()).toBeUndefined();
      expect(localStorage.getItem(BRANDING_KEY)).toBeNull();
    }
  });

  it("never throws when storage is unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("denied");
      },
    });
    try {
      expect(readSnapshot()).toBeUndefined();
      expect(() => writeSnapshot(good)).not.toThrow();
    } finally {
      Object.defineProperty(window, "localStorage", original);
    }
  });
});
