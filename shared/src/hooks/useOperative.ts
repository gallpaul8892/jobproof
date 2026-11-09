import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getOperativeJob, listOperativeJobs, type OperativeJob, type OperativeJobList } from "../generated";
import { callApi } from "../api/client";
import { queryKeys } from "../api/queryKeys";
import { shouldRetry } from "./useManager";

const FIVE_MINUTES = 5 * 60_000;

/** A job from the list carries its detail (notes, contact, checklist) only if the server sent them. */
function hasDetail(job: OperativeJob): boolean {
  return Array.isArray(job.checklist);
}

/**
 * The operative's jobs for today and earlier unfinished ones. Every job in the answer is also
 * written under its own detail key, so a job opens offline without ever having been opened (T-003d 9).
 */
export function useOperativeJobs() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.operativeJobs,
    queryFn: async ({ signal }): Promise<OperativeJobList> => {
      const list = await callApi(() => listOperativeJobs({ signal }));
      for (const job of [...list.jobs_today, ...list.earlier_unfinished]) {
        if (hasDetail(job)) queryClient.setQueryData(queryKeys.operativeJob(job.id), job);
      }
      return list;
    },
    staleTime: FIVE_MINUTES,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: shouldRetry,
    retryDelay: 400,
  });
}

/** One job. Starts from the list cache when the job is in it; an unknown or foreign job is a 404. */
export function useOperativeJob(id: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.operativeJob(id),
    queryFn: ({ signal }) => callApi(() => getOperativeJob({ path: { job_id: id }, signal })),
    initialData: () => {
      const list = queryClient.getQueryData<OperativeJobList>(queryKeys.operativeJobs);
      const job = list && [...list.jobs_today, ...list.earlier_unfinished].find((j) => j.id === id);
      return job && hasDetail(job) ? job : undefined;
    },
    initialDataUpdatedAt: () => queryClient.getQueryState(queryKeys.operativeJobs)?.dataUpdatedAt,
    staleTime: FIVE_MINUTES,
    refetchOnReconnect: true,
    retry: shouldRetry,
    retryDelay: 400,
  });
}
