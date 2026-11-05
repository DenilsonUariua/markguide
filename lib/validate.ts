import { MAX_FILE_BYTES, MAX_GUIDE_FILES } from "@/lib/constants";
import type { Rubric } from "@/lib/types";

export class RequestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface IncomingFile {
  mimeType: string;
  data: string;
}

const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export function parseFile(value: unknown, label = "file"): IncomingFile {
  if (!value || typeof value !== "object") {
    throw new RequestError(`No ${label} was received.`);
  }

  const { mimeType, data } = value as Record<string, unknown>;

  if (typeof mimeType !== "string" || !ALLOWED_MIME.has(mimeType)) {
    throw new RequestError(`That ${label} type is not supported. Use a PDF or a photo (JPG, PNG, WebP).`, 415);
  }

  if (typeof data !== "string" || data.length < 32) {
    throw new RequestError(`The ${label} arrived empty. Please upload it again.`);
  }

  // Base64 is ~4/3 the raw size; guard before spending a token budget.
  const approxBytes = Math.floor((data.length * 3) / 4);
  if (approxBytes > MAX_FILE_BYTES * 1.1) {
    throw new RequestError(
      `That ${label} is too large. Keep each file under 3 MB — a photo or a compressed PDF works fine.`,
      413,
    );
  }

  return { mimeType, data };
}

export function parseRubric(value: unknown): Rubric {
  if (!value || typeof value !== "object") {
    throw new RequestError("The marking guide was not sent with this request.");
  }

  const rubric = value as Rubric;
  if (!Array.isArray(rubric.criteria) || rubric.criteria.length === 0) {
    throw new RequestError("The marking guide has no criteria to mark against.");
  }

  const criteria = rubric.criteria
    .filter((c) => c && typeof c.name === "string" && c.name.trim())
    .map((c) => ({
      name: String(c.name).trim().slice(0, 200),
      maxMarks: Number(c.maxMarks) || 0,
      description: String(c.description ?? "").slice(0, 1500),
    }));

  if (criteria.length === 0) {
    throw new RequestError("The marking guide has no criteria to mark against.");
  }

  const totalMarks = criteria.reduce((sum, c) => sum + c.maxMarks, 0);

  return {
    title: String(rubric.title ?? "Marking guide").slice(0, 200),
    subject: String(rubric.subject ?? "").slice(0, 100),
    totalMarks,
    gradingNotes: String(rubric.gradingNotes ?? "").slice(0, 1000),
    criteria,
  };
}

export function parseGuideFiles(value: unknown): IncomingFile[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new RequestError("No marking guide was uploaded.");
  }
  if (value.length > MAX_GUIDE_FILES) {
    throw new RequestError(`A marking guide can be at most ${MAX_GUIDE_FILES} files.`);
  }

  const files = value.map((file, index) => parseFile(file, `page ${index + 1} of the marking guide`));
  const totalBytes = files.reduce((sum, f) => sum + Math.floor((f.data.length * 3) / 4), 0);

  if (totalBytes > MAX_FILE_BYTES) {
    throw new RequestError(
      "The marking guide pages add up to more than 3 MB. Try removing a page or uploading a compressed PDF.",
      413,
    );
  }

  return files;
}
