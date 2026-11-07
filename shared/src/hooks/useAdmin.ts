import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAdminSettings, updateAdminSettings, type AdminSettings, type AdminSettingsUpdate } from "../generated";
import { callApi } from "../api/client";
import { queryKeys } from "../api/queryKeys";
import { shouldRetry } from "./useManager";

export function useAdminSettings() {
  return useQuery({
    queryKey: queryKeys.adminSettings,
    queryFn: ({ signal }) => callApi(() => getAdminSettings({ signal })),
    retry: shouldRetry,
    retryDelay: 400,
  });
}

/** On success the admin sees the change at once: both the settings and branding caches update. */
export function useUpdateAdminSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminSettingsUpdate) => callApi(() => updateAdminSettings({ body })),
    onSuccess: (data: AdminSettings) => {
      queryClient.setQueryData(queryKeys.adminSettings, data);
      queryClient.setQueryData(queryKeys.branding, { company_name: data.company_name, theme: data.theme });
    },
  });
}
