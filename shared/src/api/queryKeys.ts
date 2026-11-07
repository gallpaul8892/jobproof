import type { InvoiceFilters, ReportFilters } from "../filters";

export const queryKeys = {
  health: ["health"] as const,
  me: ["me"] as const,
  demoAccounts: ["demo-accounts"] as const,
  branding: ["branding"] as const,
  adminSettings: ["admin-settings"] as const,
  dashboard: ["dashboard"] as const,
  painters: ["painters"] as const,
  reports: (filters: ReportFilters) => ["reports", filters] as const,
  report: (id: string) => ["report", id] as const,
  invoices: (filters: InvoiceFilters) => ["invoices", filters] as const,
};
