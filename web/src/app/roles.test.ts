import { describe, expect, it } from "vitest";
import { canVisit, homeFor } from "./roles";

describe("roles", () => {
  it("lands each role on its home", () => {
    expect(homeFor("manager")).toBe("/");
    expect(homeFor("admin")).toBe("/settings");
    expect(homeFor("painter")).toBe("/not-authorised");
  });

  it("managers visit manager pages only", () => {
    for (const p of ["/", "/reports", "/reports/abc", "/billing", "/reports?page=2"]) expect(canVisit("manager", p), p).toBe(true);
    for (const p of ["/settings", "/login", "/reportsx"]) expect(canVisit("manager", p), p).toBe(false);
  });

  it("admins visit settings only", () => {
    expect(canVisit("admin", "/settings")).toBe(true);
    for (const p of ["/", "/reports", "/reports/abc", "/billing"]) expect(canVisit("admin", p), p).toBe(false);
  });

  it("painters visit nothing", () => {
    expect(canVisit("painter", "/")).toBe(false);
    expect(canVisit("painter", "/settings")).toBe(false);
  });
});
