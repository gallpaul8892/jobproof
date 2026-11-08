import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getManagerCustomer,
  listManagerCustomerHistory,
  updateManagerCustomer,
  type CustomerRecord,
  type CustomerUpdate,
} from "../generated";
import { callApi } from "../api/client";
import { queryKeys } from "../api/queryKeys";
import { shouldRetry } from "./useManager";

export function useCustomer(id: string) {
  return useQuery({
    queryKey: queryKeys.customer(id),
    queryFn: ({ signal }) => callApi(() => getManagerCustomer({ path: { customer_id: id }, signal })),
    retry: shouldRetry,
    retryDelay: 400,
  });
}

/** The latest 100 audit events for a customer; independent of the customer query. */
export function useCustomerHistory(id: string) {
  return useQuery({
    queryKey: queryKeys.customerHistory(id),
    queryFn: ({ signal }) => callApi(() => listManagerCustomerHistory({ path: { customer_id: id }, signal })),
    retry: shouldRetry,
    retryDelay: 400,
  });
}

/**
 * Save customer edits. The body comes from `buildCustomerUpdate`. The customer's name and contact
 * details appear on reports, their histories, lists, invoices and the dashboard, so those refetch.
 */
export function useUpdateCustomer(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomerUpdate) => callApi(() => updateManagerCustomer({ path: { customer_id: id }, body })),
    onSuccess: (data: CustomerRecord) => {
      queryClient.setQueryData(queryKeys.customer(id), data);
      for (const key of [queryKeys.customerHistory(id), ["report"], ["report-history"], ["reports"], ["invoices"], ["dashboard"]]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

/**
 * Loads the newest saved customer right now (never from cache); rejects if it cannot be loaded. Calls
 * the API directly so a failure leaves the page's own query alone.
 */
export function useFetchLatestCustomer(id: string) {
  const queryClient = useQueryClient();
  return async (): Promise<CustomerRecord> => {
    const latest = await callApi(() => getManagerCustomer({ path: { customer_id: id } }));
    queryClient.setQueryData(queryKeys.customer(id), latest);
    void queryClient.invalidateQueries({ queryKey: queryKeys.customerHistory(id) });
    return latest;
  };
}
