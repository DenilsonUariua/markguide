/**
 * Writes the CSV exactly the way the app's "Download marks (CSV)" button does,
 * using the sample batch in sample-results.json. Used to show the current output.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const batch = JSON.parse(readFileSync(join(here, "sample-results.json"), "utf8"));

const formatMark = (value) => (Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, ""));

function escape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const header = [
  "Student",
  "Mark",
  "Out of",
  "%",
  ...batch.rubric.criteria.map((c) => `${c.name} (/${formatMark(c.maxMarks)})`),
  "Overall comment",
  "Flags",
  "Confidence",
];

const rows = [...batch.students]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((student) => [
    student.name,
    formatMark(student.total),
    formatMark(student.maxMarks),
    String(Math.round(student.percentage)),
    ...batch.rubric.criteria.map((criterion) => {
      const found = student.criteria.find((c) => c.name === criterion.name);
      return found ? formatMark(found.awarded) : "0";
    }),
    student.overallComment,
    student.flags.join(" | "),
    student.confidence,
  ]);

const csv = [header, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
const out = join(here, "..", "preview", "markguide-grade-9-english-hl-narrative-essay-2026-11-06.csv");

writeFileSync(out, `\uFEFF${csv}`, "utf8");
console.log(`wrote ${out}`);
console.log(`\n--- raw CSV (${csv.split("\r\n").length} lines) ---\n`);
console.log(csv);
