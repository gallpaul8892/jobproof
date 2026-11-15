import type { PhotoStage } from "@jobproof/shared";

// A port of PlaceholderPhotoStore.render (backend/app/photos/store.py): the same generated
// placeholder pictures, drawn in the browser and served as data URIs so nothing is fetched.

const STAGE_STYLE: Record<PhotoStage, [label: string, bg: string, wall: string, accent: string]> = {
  before: ["Before", "#8a97a8", "#aab5c3", "#6f7c8d"],
  during: ["During", "#d9a441", "#ebc680", "#b98727"],
  after: ["After", "#5f9e6e", "#92c59c", "#487c55"],
};
const THUMB_DIVISOR = 4;
const MAX_CAPTION_LINES = 3;

const esc = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Greedy word wrap, breaking words longer than `width` (like Python's textwrap.wrap). */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (let word of text.split(/\s+/).filter(Boolean)) {
    while (word.length > width) {
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (line === "") line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function captionLines(caption: string, width: number): string[] {
  let lines = wrap(caption, width);
  if (lines.length > MAX_CAPTION_LINES) {
    lines = lines.slice(0, MAX_CAPTION_LINES);
    lines[MAX_CAPTION_LINES - 1] = lines[MAX_CAPTION_LINES - 1]!.slice(0, width - 1).trimEnd() + "…";
  }
  return lines.length > 0 ? lines : [""];
}

function illustration(kind: number, w: number, h: number, wall: string, accent: string): string {
  const floorY = Math.round(h * 0.72);
  const skirting = Math.round(h * 0.03);
  const parts = [
    `<rect y="${floorY}" width="${w}" height="${h - floorY}" fill="${accent}"/>`,
    `<rect y="${floorY - skirting}" width="${w}" height="${skirting}" fill="#f4f1ea"/>`,
  ];
  if (kind === 0) {
    const [x, y, fw, fh] = [Math.round(w * 0.55), Math.round(h * 0.14), Math.round(w * 0.3), Math.round(h * 0.34)];
    parts.push(`<rect x="${x}" y="${y}" width="${fw}" height="${fh}" fill="#f4f1ea"/>`);
    parts.push(`<rect x="${x + 12}" y="${y + 12}" width="${fw - 24}" height="${fh - 24}" fill="#cfe3ee"/>`);
    parts.push(`<rect x="${x + Math.floor(fw / 2) - 4}" y="${y + 12}" width="8" height="${fh - 24}" fill="#f4f1ea"/>`);
  } else if (kind === 1) {
    const [x, y, fw] = [Math.round(w * 0.12), Math.round(h * 0.1), Math.round(w * 0.22)];
    const fh = floorY - Math.round(h * 0.1);
    parts.push(`<rect x="${x}" y="${y}" width="${fw}" height="${fh}" fill="#f4f1ea"/>`);
    parts.push(`<rect x="${x + 14}" y="${y + 14}" width="${fw - 28}" height="${fh - 14}" fill="${accent}"/>`);
    parts.push(`<circle cx="${x + fw - 34}" cy="${y + Math.floor(fh / 2)}" r="9" fill="#c9b27c"/>`);
  } else {
    const [x, y, fw, fh] = [Math.round(w * 0.35), Math.round(h * 0.16), Math.round(w * 0.3), Math.round(h * 0.22)];
    parts.push(`<rect x="${x}" y="${y}" width="${fw}" height="${fh}" fill="#f4f1ea"/>`);
    parts.push(`<rect x="${x + 14}" y="${y + 14}" width="${fw - 28}" height="${fh - 28}" fill="${wall}" opacity="0.55"/>`);
  }
  return parts.join("");
}

const STAMP = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function stamp(takenAt: string): string {
  const parts = Object.fromEntries(STAMP.formatToParts(new Date(takenAt)).map((p) => [p.type, p.value]));
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute}`;
}

export interface PlaceholderPhoto {
  id: string;
  stage: PhotoStage;
  caption: string;
  taken_at: string;
  width: number;
  height: number;
}

export function renderPlaceholderSvg(photo: PlaceholderPhoto, reference: string, variant: "thumb" | "full"): string {
  const { width: w, height: h } = photo;
  const [label, bg, wall, accent] = STAGE_STYLE[photo.stage];
  const outW = variant === "thumb" ? Math.floor(w / THUMB_DIVISOR) : w;
  const outH = variant === "thumb" ? Math.floor(h / THUMB_DIVISOR) : h;
  const font = Math.round(Math.min(w, h) * 0.04);
  const lines = captionLines(photo.caption, Math.max(20, Math.round((w * 0.9) / (font * 0.56))));
  const barH = font * (lines.length + 3);
  const barY = h - barH;
  const kind = Number(BigInt(`0x${photo.id.replace(/-/g, "")}`) % 3n);
  const textX = Math.round(w * 0.04);
  const text = [
    `<text x="${textX}" y="${barY + font + 6}" font-size="${font}" font-weight="700">${esc(reference)} · ${label}</text>`,
    ...lines.map(
      (line, i) => `<text x="${textX}" y="${barY + font * (i + 2) + 10}" font-size="${font}">${esc(line)}</text>`,
    ),
    `<text x="${textX}" y="${barY + font * (lines.length + 2) + 14}" font-size="${Math.round(font * 0.8)}" opacity="0.85">${esc(stamp(photo.taken_at))}</text>`,
  ];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${w} ${h}" role="img">` +
    `<title>${esc(reference)} ${label}: ${esc(photo.caption)}</title>` +
    `<rect width="${w}" height="${h}" fill="${wall}"/>` +
    illustration(kind, w, h, bg, accent) +
    `<rect y="${barY}" width="${w}" height="${barH}" fill="#1f2933" opacity="0.82"/>` +
    `<g fill="white" font-family="sans-serif">${text.join("")}</g></svg>`
  );
}

export function placeholderDataUri(photo: PlaceholderPhoto, reference: string, variant: "thumb" | "full"): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderPlaceholderSvg(photo, reference, variant))}`;
}
