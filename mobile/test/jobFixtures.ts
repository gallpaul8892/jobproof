import type { OperativeChecklistItem, OperativeJob, OperativeJobList } from "@jobproof/shared";

const LABELS = [
  "Walls filled and sanded",
  "Ceilings painted, two coats",
  "Walls painted, two coats",
  "Woodwork undercoated",
  "Woodwork gloss finished",
  "Radiators masked and painted",
  "Dust sheets removed",
  "Brushes and rollers cleaned",
  "Site left clean and tidy",
];

export function checklist(n = 9, jobId = "job-lounge"): OperativeChecklistItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${jobId}-item-${i + 1}`,
    position: i + 1,
    label: LABELS[i] ?? `Extra task ${i + 1}`,
    status: "open",
    note: null,
    removed: false,
  }));
}

export function makeJob(over: Partial<OperativeJob> & { id: string }): OperativeJob {
  const items = over.checklist ?? [];
  return {
    reference: "JOB-2026-0101",
    title: "Repaint lounge, hall and landing",
    job_type: "interior_repaint",
    status: "to_do",
    scheduled_start: "2026-11-09",
    site_address: { line1: "12 Elm Road", line2: null, town: "Bristol", county: null, postcode: "BS6 5QA" },
    checklist_total: items.filter((i) => !i.removed).length,
    checklist_dealt_with: 0,
    notes: "Key safe by the front door; code sent by text",
    contact: { name: "Mrs A. Patel", phone: "07700 900555" },
    checklist: items,
    report: null,
    ...over,
  } as OperativeJob;
}

export const LOUNGE = makeJob({ id: "job-lounge", checklist: checklist(9) });
export const WALL = makeJob({
  id: "job-wall",
  reference: "JOB-2026-0102",
  title: "Paper bedroom feature wall",
  job_type: "wallpapering",
  site_address: { line1: "3 Oak Close", line2: null, town: "Bristol", county: null, postcode: "BS8 2PX" },
  contact: { name: "Mr T. Okafor", phone: "07700 900777" },
  notes: null,
});
export const EXTERIOR = makeJob({
  id: "job-exterior",
  reference: "JOB-2026-0103",
  title: "Exterior repaint, front elevation",
  job_type: "exterior_repaint",
  site_address: { line1: "9 Mill Lane", line2: null, town: "Bristol", county: null, postcode: "BS3 1AB" },
  checklist: checklist(14, "job-exterior"),
  notes: "x".repeat(1500),
});

export function list(over: Partial<OperativeJobList> = {}): OperativeJobList {
  return { as_of: "2026-11-09T07:42:00Z", today: "2026-11-09", jobs_today: [LOUNGE, WALL, EXTERIOR], earlier_unfinished: [], ...over };
}
