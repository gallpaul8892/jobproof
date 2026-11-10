/**
 * When was a gallery photo taken? From the file's own EXIF `DateTimeOriginal` (design 3.6 step 5).
 * EXIF stores local wall-clock time "2026:11:09 08:14:03", with the offset in `OffsetTimeOriginal`
 * ("+01:00") when the camera wrote one; without it the time is read as Europe/London local time.
 */
const LONDON_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** London's offset from UTC in minutes at an instant (60 in summer, 0 in winter). */
function londonOffsetMinutes(utcMs: number): number {
  const p: Record<string, number> = {};
  for (const part of LONDON_PARTS.formatToParts(new Date(utcMs))) if (part.type !== "literal") p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** Converts London wall-clock fields to a UTC instant (the hour that does not exist or repeats at a clock change resolves to the later reading). */
export function londonLocalToUtcMs(y: number, mo: number, d: number, h: number, mi: number, s: number): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const first = guess - londonOffsetMinutes(guess) * 60000;
  const second = guess - londonOffsetMinutes(first) * 60000;
  return second;
}

const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const OFFSET = /^([+-])(\d{2}):?(\d{2})$/;

export interface ExifLike {
  DateTimeOriginal?: unknown;
  DateTimeDigitized?: unknown;
  OffsetTimeOriginal?: unknown;
  OffsetTimeDigitized?: unknown;
  [key: string]: unknown;
}

/** The UTC instant (ISO string) the photo was taken, or null when the file does not say (or says nonsense such as 0000:00:00). */
export function parseExifTakenAt(exif: ExifLike | null | undefined): string | null {
  if (!exif) return null;
  const useDigitized = typeof exif.DateTimeOriginal !== "string" || !EXIF_DATE.test(exif.DateTimeOriginal);
  const raw = useDigitized ? exif.DateTimeDigitized : exif.DateTimeOriginal;
  if (typeof raw !== "string") return null;
  const m = EXIF_DATE.exec(raw.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  if (y < 1990 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1) return null; // 31 February
  const offsetRaw = useDigitized ? exif.OffsetTimeDigitized : exif.OffsetTimeOriginal;
  const off = typeof offsetRaw === "string" ? OFFSET.exec(offsetRaw.trim()) : null;
  const ms = off
    ? Date.UTC(y, mo - 1, d, h, mi, Math.min(s, 59)) - (off[1] === "-" ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3])) * 60000
    : londonLocalToUtcMs(y, mo, d, h, mi, Math.min(s, 59));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
