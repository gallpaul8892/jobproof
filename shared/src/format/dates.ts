const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-11-07" to "7 Nov 2026". Calendar dates have no time zone, so no conversion happens. */
export function formatDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** "2026-11-01" to "November 2026". */
export function formatMonth(date: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(date);
  if (!m) return date;
  return `${FULL_MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

const londonParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** UTC ISO instant to "7 Nov 2026, 14:05" in Europe/London (GMT or BST). */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p: Record<string, string> = {};
  for (const part of londonParts.formatToParts(d)) p[part.type] = part.value;
  return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute}`;
}

const londonDay = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

/** The Europe/London calendar day of an instant, as a day number (days since 1970-01-01). */
function londonDayNumber(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p: Record<string, string> = {};
  for (const part of londonDay.formatToParts(d)) p[part.type] = part.value;
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / 86_400_000;
}

/**
 * "Waiting since today", "Waiting 1 day", "Waiting n days": whole Europe/London calendar days
 * between the submitted date and `asOf` (the server's clock, so tests with a fixed clock are stable).
 */
export function waitingLabel(submittedAt: string, asOf: string): string {
  const from = londonDayNumber(submittedAt);
  const to = londonDayNumber(asOf);
  if (from === null || to === null) return "";
  const days = Math.max(0, Math.round(to - from));
  if (days === 0) return "Waiting since today";
  return days === 1 ? "Waiting 1 day" : `Waiting ${days} days`;
}

/** UTC ISO instant to "11:40" in Europe/London. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p: Record<string, string> = {};
  for (const part of londonParts.formatToParts(d)) p[part.type] = part.value;
  return `${p.hour}:${p.minute}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The Europe/London calendar date of an instant, "2026-11-09". Pass the clock in tests. */
export function londonDateOf(instant: Date | string): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(d.getTime())) return "";
  const p: Record<string, string> = {};
  for (const part of londonDay.formatToParts(d)) p[part.type] = part.value;
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "2026-11-09" to "Mon 9 Nov". A calendar date has no time zone, so the weekday is computed from the date alone. */
export function formatWeekdayDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  const weekday = WEEKDAYS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()];
  return `${weekday} ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}
