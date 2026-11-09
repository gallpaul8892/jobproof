import type { InvoiceFilters, ReportFilters } from "../filters";

export const queryKeys = {
  health: ["health"] as const,
  appStatus: ["app", "status"] as const,
  me: ["me"] as const,
  demoAccounts: ["demo-accounts"] as const,
  branding: ["branding"] as const,
  adminSettings: ["admin-settings"] as const,
  dashboard: ["dashboard"] as const,
  painters: ["painters"] as const,
  reports: (filters: ReportFilters, pageSize?: number) => ["reports", filters, pageSize] as const,
  report: (id: string) => ["report", id] as const,
  reportHistory: (id: string) => ["report-history", id] as const,
  customer: (id: string) => ["customer", id] as const,
  customerHistory: (id: string) => ["customer-history", id] as const,
  operativeJobs: ["operative", "jobs"] as const,
  operativeJob: (id: string) => ["operative", "job", id] as const,
  invoices: (filters: InvoiceFilters) => ["invoices", filters] as const,
};
