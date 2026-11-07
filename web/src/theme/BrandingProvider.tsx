import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useBranding, type Branding } from "@jobproof/shared";
import { applyTheme } from "./applyTheme";
import { readSnapshot, writeSnapshot } from "./brandingCache";

export type BrandingState = "loading" | "ready" | "failed";

interface BrandingContextValue {
  name: string | undefined;
  state: BrandingState;
}

const BrandingContext = createContext<BrandingContextValue>({ name: undefined, state: "loading" });

/** The company name once known (snapshot or server), else undefined. */
export function useCompanyName(): string | undefined {
  return useContext(BrandingContext).name;
}

export function useBrandingState(): BrandingState {
  return useContext(BrandingContext).state;
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [initial] = useState<Branding | undefined>(() => readSnapshot());
  const query = useBranding({ initial });
  const data = query.data;

  // Paint the theme whenever it changes. On failure the current values (snapshot or defaults) stay.
  useEffect(() => {
    if (data) applyTheme(data.theme);
  }, [data]);

  // Only a server answer is stored (dataUpdatedAt is 0 for the snapshot itself).
  useEffect(() => {
    if (data && query.dataUpdatedAt > 0) writeSnapshot(data);
  }, [data, query.dataUpdatedAt]);

  const value = useMemo<BrandingContextValue>(
    () => ({
      name: data?.company_name,
      state: data ? "ready" : query.isError ? "failed" : "loading",
    }),
    [data, query.isError],
  );
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}
