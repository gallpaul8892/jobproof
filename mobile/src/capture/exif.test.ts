import { londonLocalToUtcMs, parseExifTakenAt } from "./exif";

describe("parseExifTakenAt", () => {
  it("uses the offset the camera wrote", () => {
    expect(parseExifTakenAt({ DateTimeOriginal: "2026:07:01 08:14:03", OffsetTimeOriginal: "+01:00" })).toBe("2026-07-01T07:14:03.000Z");
    expect(parseExifTakenAt({ DateTimeOriginal: "2026:01:15 08:14:03", OffsetTimeOriginal: "-05:30" })).toBe("2026-01-15T13:44:03.000Z");
  });
  it("reads a time with no offset as Europe/London local time: BST in summer, GMT in winter", () => {
    expect(parseExifTakenAt({ DateTimeOriginal: "2026:07:01 08:14:03" })).toBe("2026-07-01T07:14:03.000Z");
    expect(parseExifTakenAt({ DateTimeOriginal: "2026:11:08 17:05:09" })).toBe("2026-11-08T17:05:09.000Z");
  });
  it("handles the clock-change days", () => {
    expect(new Date(londonLocalToUtcMs(2026, 3, 29, 12, 0, 0)).toISOString()).toBe("2026-03-29T11:00:00.000Z"); // BST began that morning
    expect(new Date(londonLocalToUtcMs(2026, 10, 25, 12, 0, 0)).toISOString()).toBe("2026-10-25T12:00:00.000Z"); // GMT again
  });
  it("falls back to DateTimeDigitized, then to nothing", () => {
    expect(parseExifTakenAt({ DateTimeDigitized: "2026:11:08 10:00:00" })).toBe("2026-11-08T10:00:00.000Z");
    expect(parseExifTakenAt({})).toBeNull();
    expect(parseExifTakenAt(null)).toBeNull();
    expect(parseExifTakenAt(undefined)).toBeNull();
  });
  it.each(["0000:00:00 00:00:00", "2026:13:01 00:00:00", "2026:02:31 10:00:00", "not a date", "2026:11:08 25:00:00", "1970:01:01 00:00:00"])("rejects %s", (raw) => {
    expect(parseExifTakenAt({ DateTimeOriginal: raw })).toBeNull();
  });
  it("ignores non-string values", () => {
    expect(parseExifTakenAt({ DateTimeOriginal: 12345 })).toBeNull();
  });
});
