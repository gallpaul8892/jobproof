import { QueryClient } from "@tanstack/react-query";
import { queryKeys, type OperativeJob, type OperativeJobList } from "@jobproof/shared";
import { cacheSavedJob } from "./SyncProvider";

const job = (notes: string | null) => ({ id: "job-a", report: { notes } }) as unknown as OperativeJob;
const list = (j: OperativeJob) => ({ jobs_today: [j], earlier_unfinished: [] }) as unknown as OperativeJobList;

describe("cacheSavedJob: the server's answer to a save wins over an older GET", () => {
  it("cancels a job GET and a list GET that were in flight before the save, so they cannot put pre-save data back", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    const stale = job("old note");
    let releaseJob!: () => void;
    let releaseList!: () => void;
    const jobGate = new Promise<void>((r) => (releaseJob = r));
    const listGate = new Promise<void>((r) => (releaseList = r));
    // Like the real GET: it ends when its signal is aborted, otherwise it answers with the old data.
    const aborts = (signal: AbortSignal) => new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    const jobFetch = client.fetchQuery({ queryKey: queryKeys.operativeJob("job-a"), queryFn: ({ signal }) => Promise.race([jobGate.then(() => stale), aborts(signal)]) });
    const listFetch = client.fetchQuery({ queryKey: queryKeys.operativeJobs, queryFn: ({ signal }) => Promise.race([listGate.then(() => list(stale)), aborts(signal)]) });
    jobFetch.catch(() => undefined);
    listFetch.catch(() => undefined);

    await cacheSavedJob(client, job("new note"));
    releaseJob();
    releaseList();
    await Promise.allSettled([jobFetch, listFetch]);

    expect(client.getQueryData<OperativeJob>(queryKeys.operativeJob("job-a"))?.report?.notes).toBe("new note");
  });

  it("writes the saved job into the detail and into the list entry", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    client.setQueryData(queryKeys.operativeJobs, list(job("old")));
    await cacheSavedJob(client, job("new"));
    expect(client.getQueryData<OperativeJobList>(queryKeys.operativeJobs)?.jobs_today[0]?.report?.notes).toBe("new");
    expect(client.getQueryData<OperativeJob>(queryKeys.operativeJob("job-a"))?.report?.notes).toBe("new");
  });
});
