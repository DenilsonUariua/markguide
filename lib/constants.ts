/**
 * Hard limits.
 *
 * Vercel serverless functions cap request bodies at 4.5 MB. Base64 inflates a
 * file by ~33%, so we keep the raw budget at 3 MB and compress images in the
 * browser before they ever reach the network.
 */
export const MAX_FILE_BYTES = 3 * 1024 * 1024; // 3 MB per file
export const MAX_GUIDE_FILES = 3;
export const MAX_GUIDE_TOTAL_BYTES = 3 * 1024 * 1024; // combined, for one request
export const MAX_STUDENT_FILES = 25;
export const MARK_CONCURRENCY = 2;

export const ACCEPTED_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export function isAcceptedMime(mime: string): boolean {
  return (ACCEPTED_MIME as readonly string[]).includes(mime);
}

export function fileKind(mime: string): "pdf" | "image" {
  return mime === "application/pdf" ? "pdf" : "image";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Strip the extension and tidy separators into something a human can read. */
export function nameFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  const cleaned = base
    .replace(/[_+]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^\d{1,2}[\s.-]+(?=[A-Za-z])/, "") // leading "01 - "
    .trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1) || "Unnamed student";
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

/** 74.5 -> "74.5", 74 -> "74" */
export function formatMark(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}
