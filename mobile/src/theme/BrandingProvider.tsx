import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useBranding, type Branding } from "@jobproof/shared";
import { readBrandingSnapshot, writeBrandingSnapshot } from "./brandingStore";
import { resolveTheme, type AppTheme } from "./tokens";

interface BrandingContextValue {
  /** The company name once known (snapshot or server); undefined before that. */
  companyName: string | undefined;
  theme: AppTheme;
}

const BrandingContext = createContext<BrandingContextValue>({ companyName: undefined, theme: resolveTheme(undefined) });

export function useAppBranding(): BrandingContextValue {
  return useContext(BrandingContext);
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [initial] = useState<Branding | undefined>(() => readBrandingSnapshot());
  const query = useBranding({ initial });
  const data = query.data;

  // Only a server answer is stored (dataUpdatedAt is 0 for the snapshot itself).
  useEffect(() => {
    if (data && query.dataUpdatedAt > 0) writeBrandingSnapshot(data);
  }, [data, query.dataUpdatedAt]);

  const value = useMemo<BrandingContextValue>(
    () => ({ companyName: data?.company_name, theme: resolveTheme(data?.theme) }),
    [data],
  );
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}
