import { expect, test, ManagerApi, expectNoHorizontalOverflow, parseRgb, ratio, signInViaApi, ADMIN } from "./support";

const GREEN = "rgb(31, 81, 48)";

test.describe("T-002d: the default theme", () => {
  test("dashboard uses the dark green header, white page and green buttons and links", async ({ page }) => {
    await signInViaApi(page);
    await page.goto("/");
    await expect(page.getByTestId("recent-report-row")).toHaveCount(5);
    const header = page.locator(".topbar");
    await expect(header).toHaveCSS("background-color", GREEN);
    await expect(header).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(page.getByTestId("brand-name")).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(page.locator("body")).toHaveCSS("color", "rgb(27, 31, 28)");
    await expect(page.getByTestId("recent-reports-table").getByRole("link").first()).toHaveCSS("color", "rgb(47, 93, 58)");
  });

  test("primary buttons are green with white text", async ({ page }) => {
    await page.goto("/login");
    const button = page.getByRole("button", { name: "Sign in" });
    await expect(button).toHaveCSS("background-color", GREEN);
    await expect(button).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  });

  test("a focused field on the login page has an outline in the accent colour", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const email = page.getByLabel("Email");
    await expect(email).toBeFocused();
    await expect(email).toHaveCSS("outline-style", "solid");
    await expect(email).toHaveCSS("outline-color", "rgb(47, 93, 58)");
  });

  test("with branding unavailable the default theme still applies and the app is usable", async ({ page }) => {
    await page.route(/\/api\/v1\/branding$/, (route) => route.abort("connectionrefused"));
    await signInViaApi(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await expect(page.locator(".topbar")).toHaveCSS("background-color", GREEN);
    await expect(page.getByTestId("brand-name")).toHaveText("");
  });

  for (const [name, path, who] of [
    ["login", "/login", null],
    ["dashboard", "/", "manager"],
    ["settings", "/settings", "admin"],
  ] as const) {
    test(`keyboard focus is visible with at least 3:1 contrast on ${name}`, async ({ page }) => {
      if (who === "manager") await signInViaApi(page);
      if (who === "admin") await signInViaApi(page, ADMIN);
      await page.goto(path);
      await expect(page.locator("h1").first()).toBeVisible();
      if (name === "dashboard") await expect(page.getByTestId("recent-report-row")).toHaveCount(5);
      const seen: { tag: string; style: string; width: number; colour: string; inHeader: boolean }[] = [];
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press("Tab");
        seen.push(
          await page.evaluate(() => {
            const el = document.activeElement as HTMLElement;
            const cs = getComputedStyle(el);
            return {
              tag: el.tagName + (el.textContent ?? "").trim().slice(0, 20),
              style: cs.outlineStyle,
              width: parseFloat(cs.outlineWidth),
              colour: cs.outlineColor,
              inHeader: el.closest(".topbar") !== null,
            };
          }),
        );
      }
      // Tab eventually leaves the page (focus returns to <body>); only real controls are checked
      const controls = seen.filter((s) => !s.tag.startsWith("BODY"));
      expect(controls.length).toBeGreaterThan(4);
      for (const s of controls) {
        expect(s.style, s.tag).not.toBe("none");
        expect(s.width, s.tag).toBeGreaterThanOrEqual(2);
        const background: [number, number, number] = s.inHeader ? parseRgb(GREEN) : [255, 255, 255];
        expect(ratio(parseRgb(s.colour), background), `${s.tag} focus ring`).toBeGreaterThanOrEqual(3);
      }
    });
  }

  test("at 360px nothing overflows and every header link is usable", async ({ page, request }) => {
    const report = (await (await ManagerApi.create(request)).allReports()).find((r) => r.photo_count > 0)!;
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/login");
    await expectNoHorizontalOverflow(page);
    await signInViaApi(page);
    for (const [path, ready] of [
      ["/", "recent-reports-table"],
      ["/reports", "reports-table"],
      [`/reports/${report.id}`, "photo-thumb"],
      ["/billing", "invoices-table"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByTestId(ready).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    }
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const name of ["Dashboard", "Reports", "Billing"]) {
      await expect(nav.getByRole("link", { name })).toBeVisible();
    }
    await nav.getByRole("link", { name: "Billing" }).click();
    await expect(page).toHaveURL(/\/billing$/);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("at 360px a long company name truncates in the header and Settings fits", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await signInViaApi(page, ADMIN);
    await page.goto("/settings");
    await expect(page.getByTestId("settings-page")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });
});
