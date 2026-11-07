import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatMonth } from "./dates";
import { billingStatusLabel, jobTypeLabel, reviewStatusLabel } from "./labels";
import { formatPence } from "./money";

describe("formatPence", () => {
  it.each([
    [0, "£0.00"],
    [5, "£0.05"],
    [123456, "£1,234.56"],
    [1234560, "£12,345.60"],
    [100000000, "£1,000,000.00"],
  ])("%i -> %s", (pence, expected) => expect(formatPence(pence)).toBe(expected));
});

describe("formatDate", () => {
  it("formats calendar dates without a time zone shift", () => {
    expect(formatDate("2026-11-07")).toBe("7 Nov 2026");
    expect(formatDate("2026-09-01")).toBe("1 Sep 2026");
    expect(formatDate("2026-03-29")).toBe("29 Mar 2026");
  });
  it("formats the month heading", () => {
    expect(formatMonth("2026-11-01")).toBe("November 2026");
  });
});

describe("formatDateTime (Europe/London)", () => {
  it("shows GMT in winter", () => {
    expect(formatDateTime("2026-11-07T14:05:00Z")).toBe("7 Nov 2026, 14:05");
  });
  it("shows BST in summer", () => {
    expect(formatDateTime("2026-07-01T14:05:00Z")).toBe("1 Jul 2026, 15:05");
  });
  it("switches at the end of March (clocks forward 2026-03-29 01:00 UTC)", () => {
    expect(formatDateTime("2026-03-29T00:59:00Z")).toBe("29 Mar 2026, 00:59");
    expect(formatDateTime("2026-03-29T01:00:00Z")).toBe("29 Mar 2026, 02:00");
  });
  it("switches at the end of October (clocks back 2026-10-25 01:00 UTC)", () => {
    expect(formatDateTime("2026-10-25T00:30:00Z")).toBe("25 Oct 2026, 01:30");
    expect(formatDateTime("2026-10-25T01:30:00Z")).toBe("25 Oct 2026, 01:30");
  });
  it("shows midnight as 00:00, not 24:00", () => {
    expect(formatDateTime("2026-11-07T00:00:00Z")).toBe("7 Nov 2026, 00:00");
  });
});

describe("labels", () => {
  it("maps enums to display text", () => {
    expect(billingStatusLabel("part_paid")).toBe("Part paid");
    expect(billingStatusLabel("not_invoiced")).toBe("Not invoiced");
    expect(jobTypeLabel("kitchen_cabinet_spray")).toBe("Kitchen cabinet spray");
    expect(reviewStatusLabel("awaiting_review")).toBe("Awaiting review");
  });
  it("humanises an unknown value instead of rendering blank", () => {
    expect(billingStatusLabel("something_new" as never)).toBe("Something new");
  });
});
