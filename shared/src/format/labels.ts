import type {
  BillingStatus,
  CustomerType,
  InvoiceStatus,
  JobStatus,
  JobType,
  PhotoStage,
  ReviewStatus,
} from "../generated";

type Label<T extends string> = Record<T, string>;

const REVIEW: Label<ReviewStatus> = { awaiting_review: "Awaiting review", reviewed: "Reviewed" };
const BILLING: Label<BillingStatus> = {
  not_invoiced: "Not invoiced",
  draft: "Draft",
  sent: "Sent",
  part_paid: "Part paid",
  overdue: "Overdue",
  paid: "Paid",
  void: "Void",
};
const JOB_TYPE: Label<JobType> = {
  interior_repaint: "Interior repaint",
  exterior_repaint: "Exterior repaint",
  wallpapering: "Wallpapering",
  kitchen_cabinet_spray: "Kitchen cabinet spray",
  staircase_woodwork: "Staircase woodwork",
  commercial_unit: "Commercial unit",
};
const JOB_STATUS: Label<JobStatus> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};
const CUSTOMER_TYPE: Label<CustomerType> = {
  homeowner: "Homeowner",
  landlord: "Landlord",
  business: "Business",
};
const STAGE: Label<PhotoStage> = { before: "Before", during: "During", after: "After" };
const METHOD: Record<string, string> = { card: "Card", bank_transfer: "Bank transfer", cash: "Cash" };
const PAYMENT_KIND: Record<string, string> = { deposit: "Deposit", invoice: "Invoice payment" };
const QUOTE_STATUS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
};

/** Falls back to a humanised key so a new enum value never renders blank. */
function lookup(map: Record<string, string>, key: string): string {
  return map[key] ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export const reviewStatusLabel = (v: ReviewStatus) => lookup(REVIEW, v);
export const billingStatusLabel = (v: BillingStatus | InvoiceStatus) => lookup(BILLING, v);
export const jobTypeLabel = (v: JobType) => lookup(JOB_TYPE, v);
export const jobStatusLabel = (v: JobStatus) => lookup(JOB_STATUS, v);
export const customerTypeLabel = (v: CustomerType) => lookup(CUSTOMER_TYPE, v);
export const photoStageLabel = (v: PhotoStage) => lookup(STAGE, v);
export const paymentMethodLabel = (v: string) => lookup(METHOD, v);
export const paymentKindLabel = (v: string) => lookup(PAYMENT_KIND, v);
export const quoteStatusLabel = (v: string) => lookup(QUOTE_STATUS, v);
