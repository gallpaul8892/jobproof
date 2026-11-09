import { createContext, useContext } from "react";

/** What has not reached the office yet for one user. Photos not `sent`, plus dirty drafts and queued submits. */
export interface UnsentSummary {
  photos: number;
  /** Dirty drafts and queued submits. */
  reports: number;
}

/**
 * Injectable source of the sign-out count. T-003e supplies the SQLite-backed one, keyed by
 * `owner_user_id`; until then the default reports nothing.
 */
export interface UnsentItemsSource {
  summaryFor(userId: string): Promise<UnsentSummary> | UnsentSummary;
}

export const NO_UNSENT_ITEMS: UnsentItemsSource = { summaryFor: () => ({ photos: 0, reports: 0 }) };

export const UnsentItemsContext = createContext<UnsentItemsSource>(NO_UNSENT_ITEMS);
export const useUnsentItems = (): UnsentItemsSource => useContext(UnsentItemsContext);

export function unsentTotal(s: UnsentSummary): number {
  return s.photos + s.reports;
}

/** "4 photos haven't reached the office yet. Stay signed in so they can send." */
export function unsentMessage(s: UnsentSummary): string {
  const parts: string[] = [];
  if (s.photos > 0) parts.push(`${s.photos} ${s.photos === 1 ? "photo" : "photos"}`);
  if (s.reports > 0) parts.push(`${s.reports} ${s.reports === 1 ? "report" : "reports"}`);
  const plural = unsentTotal(s) > 1;
  return `${parts.join(" and ")} ${plural ? "haven't" : "hasn't"} reached the office yet. Stay signed in so ${plural ? "they" : "it"} can send.`;
}
