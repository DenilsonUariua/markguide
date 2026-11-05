import type { CriterionResult, MarkResult, Rubric } from "@/lib/types";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

/** Roughly matches the JSON we ask for, so responses don't get truncated. */
const MAX_OUTPUT_TOKENS = 8192;

/**
 * Marking is rubric matching, not a reasoning puzzle, so we skip the thinking
 * pass to keep a class set responsive on a phone. Gemini 2.5 Pro cannot disable
 * thinking, so it only gets a budget when one is configured explicitly.
 */
const THINKING_BUDGET = (() => {
  const configured = process.env.GEMINI_THINKING_BUDGET?.trim();
  if (configured !== undefined && configured !== "" && !Number.isNaN(Number(configured))) {
    return Number(configured);
  }
  return /flash/i.test(GEMINI_MODEL) ? 0 : undefined;
})();

export class GeminiError extends Error {
  status: number;
  detail?: string;

  constructor(message: string, status = 502, detail?: string) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
    this.detail = detail;
  }
}

export interface FilePart {
  mimeType: string;
  data: string; // base64, no data: prefix
}

interface GeminiRequest {
  systemInstruction: string;
  parts: Array<Record<string, unknown>>;
  schema: Record<string, unknown>;
  temperature?: number;
}

/**
 * Single JSON-mode call to Gemini. Retries once on rate limits / upstream 5xx,
 * because marking a batch means many calls and one hiccup shouldn't kill the run.
 */
async function generateJson<T>({ systemInstruction, parts, schema, temperature = 0.2 }: GeminiRequest): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new GeminiError(
      "The server has no Gemini API key. Add GEMINI_API_KEY to your environment and restart.",
      500,
    );
  }

  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      responseMimeType: "application/json",
      responseSchema: schema,
      ...(THINKING_BUDGET === undefined ? {} : { thinkingConfig: { thinkingBudget: THINKING_BUDGET } }),
    },
  };

  let lastError: GeminiError | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    let response: Response;

    try {
      response = await fetch(`${API_BASE}/${GEMINI_MODEL}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(55_000),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      lastError = new GeminiError(
        timedOut
          ? "Marking took too long to come back. Try again, or upload a smaller file."
          : "Could not reach Gemini. Check the server's internet connection.",
        504,
        error instanceof Error ? error.message : String(error),
      );
      if (attempt === 0) continue;
      throw lastError;
    }

    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      const retryable = response.status === 429 || response.status >= 500;
      const friendly =
        response.status === 429
          ? "Gemini is rate-limiting requests right now. Give it a few seconds and retry."
          : response.status === 400
            ? "Gemini rejected the request. The file may be corrupt or unsupported."
            : response.status === 403
              ? "The Gemini API key was rejected. Check that it is valid and that the Generative Language API is enabled."
              : "Gemini returned an error while marking.";
      lastError = new GeminiError(friendly, response.status, raw.slice(0, 600));
      if (retryable && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        continue;
      }
      throw lastError;
    }

    const json = (await response.json()) as {
      candidates?: Array<{
        finishReason?: string;
        content?: { parts?: Array<{ text?: string }> };
      }>;
      promptFeedback?: { blockReason?: string };
    };

    if (json.promptFeedback?.blockReason) {
      throw new GeminiError("Gemini declined to process this file. Try a clearer scan.", 422);
    }

    const candidate = json.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

    if (!text.trim()) {
      const reason = candidate?.finishReason;
      throw new GeminiError(
        reason === "MAX_TOKENS"
          ? "The marking guide produced too much detail for one response. Try splitting it into fewer pages."
          : "Gemini sent back an empty response. Please try again.",
        502,
        `finishReason=${reason ?? "none"} elapsed=${Date.now() - started}ms`,
      );
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new GeminiError("Could not read Gemini's response. Please try again.", 502, text.slice(0, 400));
    }
  }

  throw lastError ?? new GeminiError("Marking failed for an unknown reason.");
}

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const RUBRIC_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    subject: { type: "STRING" },
    totalMarks: { type: "NUMBER" },
    gradingNotes: { type: "STRING" },
    criteria: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          maxMarks: { type: "NUMBER" },
          description: { type: "STRING" },
        },
        required: ["name", "maxMarks", "description"],
        propertyOrdering: ["name", "maxMarks", "description"],
      },
    },
  },
  required: ["title", "subject", "totalMarks", "gradingNotes", "criteria"],
  propertyOrdering: ["title", "subject", "totalMarks", "gradingNotes", "criteria"],
} as const;

const MARK_SCHEMA = {
  type: "OBJECT",
  properties: {
    criteria: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          awarded: { type: "NUMBER" },
          comment: { type: "STRING" },
        },
        required: ["name", "awarded", "comment"],
        propertyOrdering: ["name", "awarded", "comment"],
      },
    },
    overallComment: { type: "STRING" },
    flags: { type: "ARRAY", items: { type: "STRING" } },
    confidence: { type: "STRING", enum: ["high", "medium", "low"] },
  },
  required: ["criteria", "overallComment", "flags", "confidence"],
  propertyOrdering: ["criteria", "overallComment", "flags", "confidence"],
} as const;

/* ------------------------------------------------------------------ */
/* Guide analysis                                                      */
/* ------------------------------------------------------------------ */

const GUIDE_SYSTEM = `You are an assessment specialist who turns teachers' marking guides into clean, usable rubrics.

You are precise, you never invent requirements, and you write so that a busy teacher can glance at your output and trust it.`;

const GUIDE_INSTRUCTION = `The attached file(s) are a teacher's marking guide: a memorandum, answer key, rubric or marking scheme.

Extract the rubric exactly as the guide defines it.

Rules:
1. Group the guide into assessment criteria. Use the guide's own wording for names. If the guide lists many individual questions, group related ones into a single criterion (for example "Question 1 — Algebra") instead of creating dozens of tiny ones. Aim for 3 to 12 criteria.
2. maxMarks is the marks the guide allocates to that criterion. The criteria must add up to the guide's total.
3. description: 1 to 3 sentences stating exactly what earns full marks, including partial-credit rules where the guide gives them. Quote key expected answers (formulas, dates, values) where the guide provides them. Be specific — this text is what the marking will be judged against.
4. totalMarks: the sum of all maxMarks.
5. gradingNotes: 2 to 3 sentences in plain language describing how marks will be awarded for this guide. No jargon.
6. title: a short human title, e.g. "Grade 9 Mathematics — Algebra Test". subject: just the subject, e.g. "Mathematics".
7. If the guide covers several grades or versions, use the main one and mention the choice in gradingNotes.
8. If the guide is handwritten or partly unreadable, extract what is legible and say so in gradingNotes.`;

export async function analyzeGuide(files: FilePart[]): Promise<Rubric> {
  const raw = await generateJson<Rubric>({
    systemInstruction: GUIDE_SYSTEM,
    parts: [
      ...files.map((file) => ({
        inlineData: { mimeType: file.mimeType, data: file.data },
      })),
      { text: GUIDE_INSTRUCTION },
    ],
    schema: RUBRIC_SCHEMA as unknown as Record<string, unknown>,
    temperature: 0.1,
  });

  return normalizeRubric(raw);
}

function normalizeRubric(raw: Rubric): Rubric {
  const criteria = (raw.criteria ?? [])
    .filter((c) => c && typeof c.name === "string" && c.name.trim())
    .map((c) => ({
      name: c.name.trim(),
      maxMarks: roundHalf(Math.max(0, Number(c.maxMarks) || 0)),
      description: (c.description ?? "").trim(),
    }))
    .filter((c) => c.maxMarks > 0);

  if (criteria.length === 0) {
    throw new GeminiError(
      "No mark allocations could be read from that guide. Try a clearer copy, or one that lists the marks for each question.",
      422,
    );
  }

  const sum = criteria.reduce((total, c) => total + c.maxMarks, 0);

  return {
    title: (raw.title ?? "").trim() || "Marking guide",
    subject: (raw.subject ?? "").trim(),
    totalMarks: sum,
    gradingNotes: (raw.gradingNotes ?? "").trim(),
    criteria,
  };
}

/* ------------------------------------------------------------------ */
/* Marking one document                                                */
/* ------------------------------------------------------------------ */

const MARK_SYSTEM = `You are an experienced, fair teacher marking a student's work against a marking guide.

You are consistent: identical answers get identical marks. You award marks only for work that is actually visible in the document. You never invent content, and you never assume a student meant something they did not write.`;

function buildMarkInstruction(rubric: Rubric, studentName: string): string {
  const criteriaList = rubric.criteria
    .map((c, i) => `${i + 1}. ${c.name} (max ${c.maxMarks}) — ${c.description}`)
    .join("\n");

  return `MARKING GUIDE
Title: ${rubric.title}
Subject: ${rubric.subject || "not stated"}
Total available: ${rubric.totalMarks}
How marks are awarded: ${rubric.gradingNotes || "Award marks against the criteria below."}

CRITERIA
${criteriaList}

STUDENT: ${studentName}

Mark the attached student work against the guide above.

Rules:
1. Award marks for every criterion, between 0 and that criterion's maximum. Halves (0.5) are allowed; nothing finer.
2. Use the exact criterion names above, in the same order.
3. If the student did not attempt a criterion, award 0 and say so in the comment.
4. Each comment must be under 25 words and refer to what this student actually wrote. Never write generic praise.
5. overallComment: 2 to 3 sentences written to the teacher (not the student). Name the strongest area and the biggest gap.
6. flags: only genuine concerns the teacher should check by hand — illegible handwriting, a missing page, an answer that could be read two ways, a mark that sits right on a grade boundary. Return an empty array if there are none.
7. confidence: "high" when the work was clearly legible and mapped unambiguously to the guide; "medium" when you had to make judgement calls; "low" when significant parts were unreadable or off-topic.`;
}

interface RawMark {
  criteria?: Array<{ name?: string; awarded?: number; comment?: string }>;
  overallComment?: string;
  flags?: string[];
  confidence?: string;
}

export async function markDocument(
  rubric: Rubric,
  student: FilePart,
  studentName: string,
): Promise<Omit<MarkResult, "durationMs" | "model">> {
  const raw = await generateJson<RawMark>({
    systemInstruction: MARK_SYSTEM,
    parts: [
      { inlineData: { mimeType: student.mimeType, data: student.data } },
      { text: buildMarkInstruction(rubric, studentName) },
    ],
    schema: MARK_SCHEMA as unknown as Record<string, unknown>,
    temperature: 0.15,
  });

  const criteria: CriterionResult[] = rubric.criteria.map((criterion, index) => {
    const match =
      raw.criteria?.find((c) => (c.name ?? "").trim().toLowerCase() === criterion.name.toLowerCase()) ??
      raw.criteria?.[index];

    const awarded = roundHalf(clamp(Number(match?.awarded) || 0, 0, criterion.maxMarks));

    return {
      name: criterion.name,
      awarded,
      maxMarks: criterion.maxMarks,
      comment: (match?.comment ?? "").trim() || "No comment returned for this criterion.",
    };
  });

  const total = roundHalf(criteria.reduce((sum, c) => sum + c.awarded, 0));
  const maxMarks = rubric.totalMarks || criteria.reduce((sum, c) => sum + c.maxMarks, 0);

  const confidence = raw.confidence === "high" || raw.confidence === "medium" || raw.confidence === "low"
    ? raw.confidence
    : "medium";

  return {
    criteria,
    total,
    maxMarks,
    percentage: maxMarks > 0 ? (total / maxMarks) * 100 : 0,
    overallComment: (raw.overallComment ?? "").trim() || "No overall comment was returned.",
    flags: (raw.flags ?? []).map((f) => String(f).trim()).filter(Boolean).slice(0, 4),
    confidence,
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}
