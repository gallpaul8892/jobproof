import { expect, test } from "@playwright/test";

test("web app loads runtime config and shows API: ok", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "JobProof" })).toBeVisible();
  await expect(page.getByTestId("api-status")).toHaveText("API: ok");
});

test("shows an error state with Try again when the API is unreachable", async ({ page }) => {
  await page.route("**/health", (route) => route.abort("connectionrefused"));
  await page.goto("/");
  await expect(page.getByTestId("api-status")).toHaveText("API: unavailable");
  await page.unroute("**/health");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("api-status")).toHaveText("API: ok");
});
