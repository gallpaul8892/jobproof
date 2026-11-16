import type { OperativeJob, User, Branding } from "@jobproof/shared";

/** The shape of operativeData.json, written by scripts/export-operative-mock-data.py. */
export interface DemoJob extends OperativeJob {
  /** The server-side job status ("scheduled", "completed", ...): needed for the list rules, not sent to the app. */
  _job_status: string;
  /** Every checklist item id of the job, removed ones included. */
  _job_items: string[];
}

/** One operative who can sign in to the demo, with only their own jobs. */
export interface DemoAccount {
  email: string;
  /** Demo-only and published (see the export script); never a real credential. */
  password: string;
  user: User;
  jobs: DemoJob[];
}

export interface OperativeMockData {
  anchor: string;
  branding: Branding;
  accounts: DemoAccount[];
}

/** What the demo shows visitors: who can sign in, never the jobs. */
export type DemoLogin = { name: string; email: string; password: string };

export const loginsOf = (data: OperativeMockData): DemoLogin[] => data.accounts.map((a) => ({ name: a.user.full_name, email: a.email, password: a.password }));
