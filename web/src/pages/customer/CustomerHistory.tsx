import { useCustomerHistory } from "@jobproof/shared";
import { HistoryView } from "../report/HistoryPanel";

/** The customer's own audit events, newest first. */
export function CustomerHistory({ customerId }: { customerId: string }) {
  return <HistoryView query={useCustomerHistory(customerId)} customerLinks={false} />;
}
