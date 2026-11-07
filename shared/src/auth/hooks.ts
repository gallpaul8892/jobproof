import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMe, listDemoAccounts, login } from "../generated";
import { callApi, getTokenStore } from "../api/client";
import { ApiError } from "../api/errors";
import { queryKeys } from "../api/queryKeys";

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (credentials: { email: string; password: string }) => {
      const result = await callApi(() => login({ body: credentials }));
      await getTokenStore().set(result.access_token);
      return result;
    },
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.me, result.user);
    },
  });
}

/** The signed-in user. Pass enabled=false when there is no token (nothing is requested). */
export function useMe(enabled = true) {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => callApi(() => getMe({ signal })),
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/** Returns a function that clears the token and every cached query. */
export function useLogout() {
  const queryClient = useQueryClient();
  return async () => {
    await getTokenStore().clear();
    queryClient.clear();
  };
}

/** 404 (disabled) is a normal answer: the data is then an empty list. */
export function useDemoAccounts() {
  return useQuery({
    queryKey: queryKeys.demoAccounts,
    queryFn: async () => {
      try {
        return await callApi(() => listDemoAccounts());
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return [];
        throw error;
      }
    },
    retry: false,
    staleTime: Infinity,
  });
}
