import type { OperativeJob, User, Branding } from "@jobproof/shared";

/** The shape of operativeData.json, written by scripts/export-operative-mock-data.py. */
export interface DemoJob extends OperativeJob {
  /** The server-side job status ("scheduled", "completed", ...): needed for the list rules, not sent to the app. */
  _job_status: string;
  /** Every checklist item id of the job, removed ones included. */
  _job_items: string[];
}

export interface OperativeMockData {
  anchor: string;
  branding: Branding;
  account: { email: string; password: string; user: User };
  jobs: DemoJob[];
}
