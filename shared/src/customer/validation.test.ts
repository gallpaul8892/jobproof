import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VALIDATORS, phoneDigits, normalisePhone, normalisePostcode, type CustomerField } from "./validation";

interface Case {
  field: CustomerField;
  /** Phone and postcode cases only: the value of the company setting `uk_only_contact_details`. */
  ukOnly?: boolean;
  input: string | null;
  ok: boolean;
  stored?: string | null;
  message?: string;
}

// The same file backend/tests/test_customer_validation.py reads, so the two twins cannot drift.
const CASES = JSON.parse(readFileSync(new URL("./validationCases.json", import.meta.url), "utf8")) as Case[];

describe("customer validators against the shared case table", () => {
  it("has a large table covering every field", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(CASES.map((c) => c.field))).toEqual(new Set(Object.keys(VALIDATORS)));
    for (const c of CASES) expect(c.ukOnly !== undefined).toBe(c.field === "phone" || c.field === "postcode");
  });

  it.each(CASES.map((c, i) => [i, c.field, JSON.stringify(c.input).slice(0, 40), c] as const))(
    "#%i %s %s",
    (_i, _field, _input, c) => {
      // A case without ukOnly holds in both modes.
      for (const ukOnly of c.ukOnly === undefined ? [true, false] : [c.ukOnly]) check(c, ukOnly);
    },
  );

  function check(c: Case, ukOnly: boolean) {
    const result = VALIDATORS[c.field](c.input, ukOnly);
    if (c.ok) expect(result).toEqual({ ok: true, value: c.stored ?? null });
    else expect(result).toEqual({ ok: false, message: c.message });
  }

  it("is idempotent on its own output", () => {
    for (const c of CASES) {
      if (c.ok && c.stored != null) {
        for (const ukOnly of c.ukOnly === undefined ? [true, false] : [c.ukOnly]) {
          expect(VALIDATORS[c.field](c.stored, ukOnly)).toEqual({ ok: true, value: c.stored });
        }
      }
    }
  });
});

describe("helpers", () => {
  it("phone helpers", () => {
    expect(phoneDigits("+44 (0)117 496-0123")).toBe("+441174960123");
    expect(phoneDigits("(0117) 496 0123")).toBe("01174960123");
    expect(normalisePhone("0117  496   0123")).toBe("0117 496 0123");
  });
  it("postcode normaliser", () => {
    expect(normalisePostcode("bs65qa")).toBe("BS6 5QA");
    expect(normalisePostcode("ec1a1bb")).toBe("EC1A 1BB");
  });
  it("counts an emoji as one character in the length rule", () => {
    expect(VALIDATORS.name("\u{1F3A8}".repeat(120)).ok).toBe(true);
    expect(VALIDATORS.name("\u{1F3A8}".repeat(121)).ok).toBe(false);
  });
});
