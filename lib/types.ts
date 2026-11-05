export type FileKind = "pdf" | "image";

/** A file held in the browser and sent to the API as base64. */
export interface UploadedFile {
  id: string;
  /** Original file name, e.g. "grade-9-memo.pdf". */
  name: string;
  mimeType: string;
  /** Base64 (no data: prefix). */
  data: string;
  sizeBytes: number;
  kind: FileKind;
  /** Object URL for image thumbnails. */
  previewUrl?: string;
}

export interface Criterion {
  name: string;
  maxMarks: number;
  description: string;
}

export interface Rubric {
  title: string;
  subject: string;
  totalMarks: number;
  /** Short plain-language note on how this guide awards marks. */
  gradingNotes: string;
  criteria: Criterion[];
}

export interface CriterionResult {
  name: string;
  awarded: number;
  maxMarks: number;
  comment: string;
}

export type Confidence = "high" | "medium" | "low";

export interface MarkResult {
  criteria: CriterionResult[];
  total: number;
  maxMarks: number;
  percentage: number;
  overallComment: string;
  flags: string[];
  confidence: Confidence;
  /** Wall-clock ms for the marking call. */
  durationMs?: number;
  /** Model id reported by the server. */
  model?: string;
}

export type StudentStatus = "queued" | "marking" | "done" | "error";

export interface StudentDoc {
  file: UploadedFile;
  /** Display name, editable by the teacher. */
  studentName: string;
  status: StudentStatus;
  result?: MarkResult;
  error?: string;
}

export interface ApiError {
  error: string;
  detail?: string;
}
