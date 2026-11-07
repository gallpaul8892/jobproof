import { describe, expect, it } from "vitest";
import {
  hasActiveFilters,
  parseInvoiceFilters,
  parseReportFilters,
  serialiseFilters,
} from "./filters";

const parse = (qs: string) => parseReportFilters(new URLSearchParams(qs));
const ID = "0a1b2c3d-0000-4000-8000-123456789abc";

describe("report filters", () => {
  it("defaults to page 1 with nothing set", () => {
    expect(parse("")).toEqual({ page: 1 });
  });

  it("round-trips valid values", () => {
    const filters = {
      page: 3,
      q: "BS6 5QA",
      review_status: "awaiting_review" as const,
      billing_status: "part_paid" as const,
      painter_id: ID,
      date_from: "2026-10-01",
      date_to: "2026-10-31",
    };
    expect(parse(serialiseFilters(filters).toString())).toEqual(filters);
  });

  it("drops invalid values", () => {
    const filters = parse(
      `page=0&q=%20%20&review_status=nope&billing_status=PAID&painter_id=abc&date_from=2026-02-30&date_to=yesterday`,
    );
    expect(filters).toEqual({ page: 1 });
  });

  it("drops an over-long search and a non-numeric page", () => {
    expect(parse(`q=${"a".repeat(101)}&page=two`)).toEqual({ page: 1 });
    expect(parse("page=-4")).toEqual({ page: 1 });
    expect(parse("page=1.5")).toEqual({ page: 1 });
  });

  it("drops date_to when it is before date_from", () => {
    expect(parse("date_from=2026-10-10&date_to=2026-10-01")).toEqual({
      page: 1,
      date_from: "2026-10-10",
    });
  });

  it("trims the search text", () => {
    expect(parse("q=%20smith%20")).toEqual({ page: 1, q: "smith" });
  });

  it("leaves page 1 and empty values out of the URL", () => {
    expect(serialiseFilters({ page: 1, q: "" }).toString()).toBe("");
    expect(serialiseFilters({ page: 2, review_status: "reviewed" }).toString()).toBe(
      "page=2&review_status=reviewed",
    );
  });

  it("reports whether a filter other than the page is active", () => {
    expect(hasActiveFilters({ page: 4 })).toBe(false);
    expect(hasActiveFilters({ page: 1, q: "x" })).toBe(true);
  });
});

describe("invoice filters", () => {
  it("round-trips and drops invalid status", () => {
    const f = parseInvoiceFilters(new URLSearchParams("status=overdue&page=2"));
    expect(f).toEqual({ page: 2, status: "overdue" });
    expect(parseInvoiceFilters(new URLSearchParams(serialiseFilters(f).toString()))).toEqual(f);
    expect(parseInvoiceFilters(new URLSearchParams("status=not_invoiced"))).toEqual({ page: 1 });
  });
});
