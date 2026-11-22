import { BACKOFF_MS, backoffDelayMs, nextDelayMs } from "./retry";

describe("retry timing (design 3.4, NFR-4)", () => {
  it("is 5 s, 15 s, 1 min, 5 min, then 15 min every time, with the middle of the jitter range", () => {
    const middle = () => 0.5;
    expect([1, 2, 3, 4, 5, 6, 20].map((n) => backoffDelayMs(n, middle))).toEqual([5_000, 15_000, 60_000, 300_000, 900_000, 900_000, 900_000]);
    expect(BACKOFF_MS).toEqual([5_000, 15_000, 60_000, 300_000, 900_000]);
  });

  it("jitters by plus or minus 20%", () => {
    expect(backoffDelayMs(1, () => 0)).toBe(4_000);
    expect(backoffDelayMs(1, () => 0.999999)).toBeLessThanOrEqual(6_000);
    expect(backoffDelayMs(1, () => 0.999999)).toBeGreaterThan(5_990);
    for (let i = 0; i < 200; i++) {
      const d = backoffDelayMs(3);
      expect(d).toBeGreaterThanOrEqual(48_000);
      expect(d).toBeLessThanOrEqual(72_000);
    }
  });

  it("treats a failure count below 1 as the first failure", () => {
    expect(backoffDelayMs(0, () => 0.5)).toBe(5_000);
  });

  it("lets Retry-After win only when it is longer", () => {
    expect(nextDelayMs(1, 30, () => 0.5)).toBe(30_000);
    expect(nextDelayMs(2, 5, () => 0.5)).toBe(15_000);
    expect(nextDelayMs(1, undefined, () => 0.5)).toBe(5_000);
  });
});
