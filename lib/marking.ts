import { AIError, generateJson, type FilePart } from "@/lib/ai";
import type { CriterionResult, MarkResult, Rubric } from "@/lib/types";

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
          evidence: { type: "STRING" },
          comment: { type: "STRING" },
        },
        required: ["name", "awarded", "evidence", "comment"],
        propertyOrdering: ["name", "awarded", "evidence", "comment"],
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
    system: GUIDE_SYSTEM,
    files,
    prompt: GUIDE_INSTRUCTION,
    schema: RUBRIC_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "marking_guide",
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
    throw new AIError(
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

You are consistent: identical answers get identical marks. You award marks only for work that is actually visible in the document. You never invent content, and you never assume a student meant something they did not write.

You also show your working. For every mark you award, you quote the words in the student's work that earned it, so the teacher can check you rather than take your word for it.`;

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
3. If the student did not attempt a criterion, award 0, put "Not attempted" in evidence, and say so in the comment.
4. evidence: the exact words from the student's work that earned the mark — a short quote, under 20 words, copied character for character including their own spelling and punctuation. A teacher reads this to check your mark, so it must genuinely appear in the document. Never paraphrase, never invent a quote, and never quote the marking guide.
5. comment: under 25 words explaining why those words earn that mark, and what was missing where marks were lost. Never write generic praise.
6. overallComment: 2 to 3 sentences written to the teacher (not the student). Name the strongest area and the biggest gap.
7. flags: only genuine concerns the teacher should check by hand — illegible handwriting, a missing page, an answer that could be read two ways, a mark that sits right on a grade boundary. Return an empty array if there are none.
8. confidence: "high" when the work was clearly legible and mapped unambiguously to the guide; "medium" when you had to make judgement calls; "low" when significant parts were unreadable or off-topic.`;
}

interface RawMark {
  criteria?: Array<{ name?: string; awarded?: number; evidence?: string; comment?: string }>;
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
    system: MARK_SYSTEM,
    files: [student],
    prompt: buildMarkInstruction(rubric, studentName),
    schema: MARK_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "student_marks",
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
      evidence: cleanEvidence(match?.evidence),
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

/**
 * Models like to wrap quotes in their own quotation marks and occasionally
 * answer "N/A". Both make the report look sloppy, so tidy it here rather than
 * trusting the wording.
 */
function cleanEvidence(value: string | undefined): string {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”‘’\u2018\u2019]+|["'“”‘’\u2018\u2019]+$/g, "")
    .trim();

  if (!text || /^(n\/?a|none|null|not applicable|no evidence)\.?$/i.test(text)) return "";
  if (text.length <= 180) return text;

  const cut = text.slice(0, 180);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 120 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, "")}…`;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}
