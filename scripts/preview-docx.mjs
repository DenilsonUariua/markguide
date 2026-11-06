/**
 * Renders the sample batch in sample-results.json to the Word report that the
 * app's "Download report (Word)" button produces, so the layout can be reviewed
 * without running the whole marking flow.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Packer } from "docx";

import { buildReport, reportFilename } from "../lib/report.ts";

const here = dirname(fileURLToPath(import.meta.url));
const batch = JSON.parse(readFileSync(join(here, "sample-results.json"), "utf8"));

const students = batch.students.map((student) => ({
  studentName: student.name,
  result: {
    criteria: student.criteria,
    total: student.total,
    maxMarks: student.maxMarks,
    percentage: student.percentage,
    overallComment: student.overallComment,
    flags: student.flags,
    confidence: student.confidence,
  },
}));

const generatedAt = new Date("2026-11-06T16:00:00Z");

const doc = buildReport({
  rubric: batch.rubric,
  students,
  generatedAt,
  model: "gemini-2.5-flash",
});

const buffer = await Packer.toBuffer(doc);
const target = join(here, "..", "preview", reportFilename(batch.rubric, generatedAt));

// The preview panel keeps the last report open, which locks it on Windows.
// Fall back to a numbered copy rather than failing the build.
let out = target;
for (let attempt = 2; ; attempt++) {
  try {
    writeFileSync(out, buffer);
    break;
  } catch (error) {
    if (error.code !== "EBUSY" && error.code !== "EPERM") throw error;
    out = target.replace(/\.docx$/, `-${attempt}.docx`);
  }
}

console.log(`wrote ${out} (${(buffer.length / 1024).toFixed(1)} KB)`);
