import { dehydrate } from "@tanstack/react-query";
import { createQueryClient } from "./queryClient";
import { PERSIST_MAX_AGE_MS } from "./persistConfig";

describe("operative data lives as long as the saved snapshot (review: gcTime)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("an unmounted list and detail are still in memory, and in the snapshot, after 5 minutes", async () => {
    const client = createQueryClient();
    await client.fetchQuery({ queryKey: ["operative", "jobs"], queryFn: async () => ({ jobs_today: [1] }) });
    await client.fetchQuery({ queryKey: ["operative", "job", "j1"], queryFn: async () => ({ id: "j1" }) });
    // A browser/RN client collects unobserved data after 5 minutes; Node would default to never, so say so.
    await client.fetchQuery({ queryKey: ["branding"], gcTime: 5 * 60_000, queryFn: async () => ({ company_name: "X" }) });

    // Nothing observes these queries (screens unmounted): this is the case the default 5-minute gc dropped.
    await jest.advanceTimersByTimeAsync(6 * 60_000);

    expect(client.getQueryData(["operative", "jobs"])).toEqual({ jobs_today: [1] });
    expect(client.getQueryData(["operative", "job", "j1"])).toEqual({ id: "j1" });
    const saved = dehydrate(client, { shouldDehydrateQuery: (q) => q.queryKey[0] === "operative" && q.state.status === "success" }).queries.map((q) => q.queryKey);
    expect(saved).toEqual([["operative", "jobs"], ["operative", "job", "j1"]]);
    // Data outside the operative keys keeps the normal 5-minute rule.
    expect(client.getQueryData(["branding"])).toBeUndefined();
    client.clear();
  });

  it("is collected only after the 7-day snapshot age", async () => {
    const client = createQueryClient();
    await client.fetchQuery({ queryKey: ["operative", "jobs"], queryFn: async () => 1 });
    await jest.advanceTimersByTimeAsync(PERSIST_MAX_AGE_MS - 1000);
    expect(client.getQueryData(["operative", "jobs"])).toBe(1);
    await jest.advanceTimersByTimeAsync(2000);
    expect(client.getQueryData(["operative", "jobs"])).toBeUndefined();
    client.clear();
  });
});
