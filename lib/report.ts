import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  VerticalAlign,
  WidthType,
  convertInchesToTwip,
} from "docx";

import type { MarkResult, Rubric } from "./types";

/**
 * A Word report for a marked batch.
 *
 * The CSV this replaces packed every comment into one cell, which is unreadable
 * on a phone and awkward to print. This builds a proper document instead: a
 * summary page the teacher can read at a glance, then one block per student with
 * the mark for each criterion and the reason behind it.
 */

export interface ReportStudent {
  studentName: string;
  result: MarkResult;
}

export interface ReportInput {
  rubric: Rubric;
  students: readonly ReportStudent[];
  generatedAt?: Date;
  /** Model id shown in the footer, e.g. "gemini-2.5-flash". */
  model?: string;
  /** School or class name, printed under the title when supplied. */
  className?: string;
}

const INK = "1D1D1F";
const MUTED = "6E6E73";
const HAIRLINE = "E3E3E8";
const FILL = "F5F5F7";
const ACCENT = "0A6CD8";
const GOOD = "1B7F4B";
const MID = "9A6100";
const LOW = "B3261E";
const WARN_FILL = "FFF6E8";

const BODY_PT = 10;
const CONTENT_INCHES = 6.77;

const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } as const;
const NO_BORDERS = {
  top: NONE,
  bottom: NONE,
  left: NONE,
  right: NONE,
  insideHorizontal: NONE,
  insideVertical: NONE,
};

function mark(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function percent(value: number): string {
  return `${Math.round(value)}%`;
}

function toneColor(percentage: number): string {
  if (percentage >= 70) return GOOD;
  if (percentage >= 50) return MID;
  return LOW;
}

function needsReview(student: ReportStudent): boolean {
  const { result } = student;
  return result.flags.length > 0 || result.confidence !== "high" || result.percentage < 40;
}

function caption(text: string, options: { color?: string; spaceAfter?: number } = {}): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: options.spaceAfter ?? 60 },
    children: [
      new TextRun({
        text: text.toUpperCase(),
        bold: true,
        size: 14,
        color: options.color ?? MUTED,
        characterSpacing: 12,
      }),
    ],
  });
}

function hairline(spacingBefore = 120, spacingAfter = 160): Paragraph {
  return new Paragraph({
    spacing: { before: spacingBefore, after: spacingAfter },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: HAIRLINE, space: 1 } },
    children: [],
  });
}

function body(text: string, options: { size?: number; color?: string; bold?: boolean; italic?: boolean; after?: number; before?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}): Paragraph {
  return new Paragraph({
    alignment: options.align,
    spacing: { before: options.before ?? 0, after: options.after ?? 80, line: 276 },
    children: [
      new TextRun({
        text,
        size: (options.size ?? BODY_PT) * 2,
        color: options.color ?? INK,
        bold: options.bold,
        italics: options.italic,
      }),
    ],
  });
}

function cell(
  children: Paragraph[],
  options: {
    width?: number;
    fill?: string;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    valign?: typeof VerticalAlign.TOP | typeof VerticalAlign.CENTER | typeof VerticalAlign.BOTTOM;
    borders?: Record<string, unknown>;
    marginLeft?: number;
    marginRight?: number;
    span?: number;
  } = {},
): TableCell {
  return new TableCell({
    children,
    columnSpan: options.span,
    width: options.width ? { size: options.width, type: WidthType.PERCENTAGE } : undefined,
    shading: options.fill
      ? { type: ShadingType.CLEAR, color: "auto", fill: options.fill }
      : undefined,
    verticalAlign: options.valign ?? VerticalAlign.TOP,
    margins: {
      top: 90,
      bottom: 90,
      left: options.marginLeft ?? 110,
      right: options.marginRight ?? 110,
    },
    borders: options.borders as never,
  });
}

function tableHeader(labels: string[], widths: number[], aligns: (typeof AlignmentType)[keyof typeof AlignmentType][]): TableRow {
  return new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: labels.map((label, index) =>
      cell([new Paragraph({ keepNext: true, children: [new TextRun({ text: label.toUpperCase(), bold: true, size: 14, color: MUTED, characterSpacing: 8 })] })], {
        width: widths[index],
        fill: FILL,
        align: aligns[index],
      }),
    ),
  });
}

export function buildReport({ rubric, students, generatedAt = new Date(), model, className }: ReportInput): Document {
  const sorted = [...students].sort((a, b) => b.result.percentage - a.result.percentage);
  const percentages = sorted.map((s) => s.result.percentage);
  const average = percentages.reduce((a, b) => a + b, 0) / (percentages.length || 1);
  const highest = Math.max(...percentages);
  const lowest = Math.min(...percentages);
  const maxMarks = sorted[0]?.result.maxMarks ?? rubric.totalMarks;
  const averageMarks = sorted.reduce((sum, s) => sum + s.result.total, 0) / (sorted.length || 1);
  const review = sorted.filter(needsReview);

  const dateLabel = generatedAt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const summaryCells = [
    { value: String(sorted.length), label: sorted.length === 1 ? "paper marked" : "papers marked" },
    { value: percent(average), label: `class average · ${mark(averageMarks)} of ${mark(maxMarks)}` },
    { value: percent(highest), label: "highest" },
    { value: percent(lowest), label: "lowest" },
  ];

  const summaryTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: NO_BORDERS,
    rows: [
      new TableRow({
        cantSplit: true,
        children: summaryCells.flatMap((item, index) => {
          const cards = [
            cell(
              [
                new Paragraph({
                  spacing: { after: 20 },
                  children: [
                    new TextRun({
                      text: item.value,
                      bold: true,
                      size: 34,
                      color: index === 1 ? toneColor(average) : INK,
                    }),
                  ],
                }),
                new Paragraph({
                  children: [new TextRun({ text: item.label, size: 15, color: MUTED })],
                }),
              ],
              { width: 23, fill: FILL },
            ),
          ];
          // A 2% gap between cards keeps them from reading as one long strip.
          return index === summaryCells.length - 1
            ? cards
            : [...cards, cell([new Paragraph({ children: [] })], { width: 2.66 })];
        }),
      }),
    ],
  });

  const rubricTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: NO_BORDERS,
    rows: [
      tableHeader(["Criterion", "Marks", "What it looks for"], [32, 12, 56], [
        AlignmentType.LEFT,
        AlignmentType.RIGHT,
        AlignmentType.LEFT,
      ]),
      ...rubric.criteria.map(
        (criterion, index) =>
          new TableRow({
            cantSplit: true,
            children: [
              cell([new Paragraph({ children: [new TextRun({ text: criterion.name, size: 19, bold: true })] })], {
                width: 32,
                borders: index === rubric.criteria.length - 1 ? undefined : { bottom: { style: BorderStyle.SINGLE, size: 4, color: HAIRLINE } },
              }),
              cell([new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: mark(criterion.maxMarks), size: 19 })] })], {
                width: 12,
                borders: index === rubric.criteria.length - 1 ? undefined : { bottom: { style: BorderStyle.SINGLE, size: 4, color: HAIRLINE } },
              }),
              cell([new Paragraph({ children: [new TextRun({ text: criterion.description, size: 18, color: MUTED })] })], {
                width: 56,
                borders: index === rubric.criteria.length - 1 ? undefined : { bottom: { style: BorderStyle.SINGLE, size: 4, color: HAIRLINE } },
              }),
            ],
          }),
      ),
    ],
  });

  const resultsTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: NO_BORDERS,
    rows: [
      tableHeader(["Student", "Mark", "%", "Check"], [52, 16, 14, 18], [
        AlignmentType.LEFT,
        AlignmentType.RIGHT,
        AlignmentType.RIGHT,
        AlignmentType.RIGHT,
      ]),
      ...sorted.map((student, index) => {
        const last = index === sorted.length - 1;
        const edge = last ? undefined : { bottom: { style: BorderStyle.SINGLE, size: 4, color: HAIRLINE } };
        return new TableRow({
          cantSplit: true,
          children: [
            cell([new Paragraph({ children: [new TextRun({ text: student.studentName, size: 19 })] })], { width: 52, borders: edge }),
            cell(
              [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({ text: mark(student.result.total), size: 19, bold: true }),
                    new TextRun({ text: ` / ${mark(student.result.maxMarks)}`, size: 18, color: MUTED }),
                  ],
                }),
              ],
              { width: 16, borders: edge },
            ),
            cell(
              [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({
                      text: percent(student.result.percentage),
                      size: 19,
                      bold: true,
                      color: toneColor(student.result.percentage),
                    }),
                  ],
                }),
              ],
              { width: 14, borders: edge },
            ),
            cell(
              [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({
                      text: needsReview(student) ? "Review" : "—",
                      size: 17,
                      color: needsReview(student) ? MID : MUTED,
                    }),
                  ],
                }),
              ],
              { width: 18, borders: edge },
            ),
          ],
        });
      }),
    ],
  });

  const studentBlocks: (Paragraph | Table)[] = [];

  /** The guide's own wording for a criterion, so the teacher can compare it to the evidence. */
  const guideWording = (name: string) =>
    rubric.criteria.find((criterion) => criterion.name === name)?.description ?? "";

  sorted.forEach((student, index) => {
    const { result } = student;
    const flagged = needsReview(student);

    if (index > 0) studentBlocks.push(new Paragraph({ spacing: { after: 200 }, children: [] }));

    // The arithmetic, spelled out: the total is only ever the sum of the rows below.
    const sumLine =
      result.criteria.length > 1
        ? `${result.criteria.map((c) => mark(c.awarded)).join(" + ")} = ${mark(result.total)} of ${mark(result.maxMarks)}`
        : "";

    studentBlocks.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        borders: NO_BORDERS,
        rows: [
          new TableRow({
            cantSplit: true,
            children: [
              cell(
                [new Paragraph({ keepNext: true, children: [new TextRun({ text: student.studentName, bold: true, size: 26 })] })],
                { width: 62, marginLeft: 0, borders: { top: { style: BorderStyle.SINGLE, size: 4, color: HAIRLINE } } },
              ),
              cell(
                [
                  new Paragraph({
                    keepNext: true,
                    alignment: AlignmentType.RIGHT,
                    children: [
                      new TextRun({ text: `${mark(result.total)} / ${mark(result.maxMarks)}`, bold: true, size: 22 }),
                      new TextRun({
                        text: `   ${percent(result.percentage)}`,
                        bold: true,
                        size: 22,
                        color: toneColor(result.percentage),
                      }),
                    ],
                  }),
                ],
                { width: 38, marginRight: 0, borders: { top: { style: BorderStyle.SINGLE, size: 4, color: HAIRLINE } } },
              ),
            ],
          }),
        ],
      }),
      new Paragraph({
        keepNext: true,
        spacing: { before: 40, after: 110 },
        children: [
          new TextRun({
            text: `Marking confidence: ${result.confidence}${flagged ? "  ·  needs a look before you record it" : ""}`,
            size: 16,
            color: flagged ? MID : MUTED,
          }),
          ...(sumLine ? [new TextRun({ text: `   ·   ${sumLine}`, size: 16, color: MUTED })] : []),
        ],
      }),
    );

    studentBlocks.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        borders: NO_BORDERS,
        rows: [
          tableHeader(["Criterion", "Mark", "Evidence and reason"], [28, 9, 63], [
            AlignmentType.LEFT,
            AlignmentType.RIGHT,
            AlignmentType.LEFT,
          ]),
          ...result.criteria.map((criterion, i) => {
            const last = i === result.criteria.length - 1;
            const edge = last ? undefined : { bottom: { style: BorderStyle.SINGLE, size: 4, color: HAIRLINE } };
            const low = criterion.maxMarks > 0 && criterion.awarded / criterion.maxMarks < 0.4;
            const evidence = (criterion.evidence ?? "").trim();
            const notAttempted = /^not attempted/i.test(evidence);
            const guide = guideWording(criterion.name);

            const evidenceParagraph = evidence
              ? new Paragraph({
                  spacing: { after: 30, line: 250 },
                  children: [
                    new TextRun({
                      text: notAttempted ? "Not attempted." : `“${evidence}”`,
                      size: 17,
                      italics: !notAttempted,
                      color: notAttempted ? MUTED : INK,
                    }),
                  ],
                })
              : null;

            return new TableRow({
              cantSplit: true,
              children: [
                cell(
                  [
                    new Paragraph({
                      spacing: { after: guide ? 30 : 0 },
                      children: [new TextRun({ text: criterion.name, size: 18, bold: true })],
                    }),
                    ...(guide
                      ? [
                          new Paragraph({
                            spacing: { line: 230 },
                            children: [
                              new TextRun({ text: "Guide: ", size: 15, bold: true, color: MUTED }),
                              new TextRun({ text: guide, size: 15, color: MUTED }),
                            ],
                          }),
                        ]
                      : []),
                  ],
                  { width: 28, borders: edge },
                ),
                cell(
                  [
                    new Paragraph({
                      alignment: AlignmentType.RIGHT,
                      children: [
                        new TextRun({ text: mark(criterion.awarded), size: 18, bold: true, color: low ? LOW : INK }),
                        new TextRun({ text: ` / ${mark(criterion.maxMarks)}`, size: 17, color: MUTED }),
                      ],
                    }),
                  ],
                  { width: 9, borders: edge },
                ),
                cell(
                  [
                    ...(evidenceParagraph ? [evidenceParagraph] : []),
                    new Paragraph({
                      spacing: { line: 250 },
                      children: [
                        new TextRun({ text: "Why: ", size: 15, bold: true, color: MUTED }),
                        new TextRun({ text: criterion.comment, size: 17 }),
                      ],
                    }),
                  ],
                  { width: 63, borders: edge },
                ),
              ],
            });
          }),
        ],
      }),
    );

    studentBlocks.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        borders: NO_BORDERS,
        rows: [
          new TableRow({
            cantSplit: true,
            children: [
              cell(
                [
                  new Paragraph({
                    spacing: { after: 40 },
                    children: [
                      new TextRun({ text: "OVERALL", bold: true, size: 14, color: MUTED, characterSpacing: 10 }),
                    ],
                  }),
                  new Paragraph({
                    spacing: { line: 264 },
                    children: [new TextRun({ text: result.overallComment, size: 18 })],
                  }),
                ],
                { width: 100, fill: FILL },
              ),
            ],
          }),
        ],
      }),
    );

    if (result.flags.length > 0) {
      studentBlocks.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          layout: TableLayoutType.FIXED,
          borders: NO_BORDERS,
          rows: [
            new TableRow({
              cantSplit: true,
              children: [
                cell(
                  [
                    new Paragraph({
                      spacing: { after: 40 },
                      children: [
                        new TextRun({ text: "CHECK THIS", bold: true, size: 14, color: MID, characterSpacing: 10 }),
                      ],
                    }),
                    ...result.flags.map(
                      (flag) =>
                        new Paragraph({
                          spacing: { line: 250, after: 40 },
                          children: [new TextRun({ text: `•  ${flag}`, size: 17, color: INK })],
                        }),
                    ),
                  ],
                  {
                    width: 100,
                    fill: WARN_FILL,
                    borders: { left: { style: BorderStyle.SINGLE, size: 18, color: "E8B04B" } },
                    marginLeft: 160,
                  },
                ),
              ],
            }),
          ],
        }),
      );
    }
  });

  const doc = new Document({
    creator: "MarkGuide",
    title: `${rubric.title} — marking report`,
    description: `${sorted.length} papers marked against ${rubric.title}`,
    styles: {
      default: {
        document: {
          run: { font: "Arial", size: BODY_PT * 2, color: INK },
          paragraph: { spacing: { line: 276 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1000, right: 1080, bottom: 1000, left: 1080 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                border: { top: { style: BorderStyle.SINGLE, size: 4, color: HAIRLINE, space: 6 } },
                spacing: { before: 0 },
                tabStops: [{ type: TabStopType.RIGHT, position: convertInchesToTwip(CONTENT_INCHES) }],
                children: [
                  new TextRun({
                    text: `MarkGuide${model ? ` · ${model}` : ""}`,
                    size: 15,
                    color: MUTED,
                  }),
                  new TextRun({ text: "\t", size: 15 }),
                  new TextRun({ text: "Page ", size: 15, color: MUTED }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 15, color: MUTED }),
                  new TextRun({ text: " of ", size: 15, color: MUTED }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 15, color: MUTED }),
                ],
              }),
            ],
          }),
        },
        children: [
          caption("Marking report", { color: ACCENT, spaceAfter: 100 }),
          new Paragraph({
            spacing: { after: 60 },
            children: [new TextRun({ text: rubric.title, bold: true, size: 44 })],
          }),
          new Paragraph({
            spacing: { after: 40 },
            children: [
              new TextRun({
                text: [rubric.subject, `${sorted.length} ${sorted.length === 1 ? "paper" : "papers"}`, `${mark(maxMarks)} marks`]
                  .filter(Boolean)
                  .join("  ·  "),
                size: 19,
                color: MUTED,
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 240 },
            children: [
              new TextRun({ text: `${dateLabel}${className ? `  ·  ${className}` : ""}`, size: 17, color: MUTED }),
            ],
          }),

          summaryTable,
          new Paragraph({ spacing: { after: 200 }, children: [] }),

          caption("How these marks were worked out"),
          body(
            rubric.gradingNotes ||
              "Each paper was read on its own and marked against the criteria below.",
            { size: 9.5, color: MUTED, after: 160 },
          ),
          rubricTable,
          new Paragraph({ spacing: { after: 260 }, children: [] }),

          caption("Class results"),
          resultsTable,

          new Paragraph({
            pageBreakBefore: true,
            spacing: { after: 120 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: HAIRLINE, space: 6 } },
            children: [new TextRun({ text: "Paper by paper", bold: true, size: 30 })],
          }),
          body(
            "For each criterion: what your guide asks for, the words in the paper that earned the mark, and the reason for the mark. Quotes are copied exactly as the learner wrote them, spelling mistakes and all. Check a quote against the paper and you have checked the mark — every total is only ever the sum of these rows.",
            { size: 9.5, color: MUTED, after: 240 },
          ),

          ...studentBlocks,

          ...(review.length > 0
            ? [
                new Paragraph({
                  pageBreakBefore: true,
                  spacing: { after: 120 },
                  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: HAIRLINE, space: 6 } },
                  children: [new TextRun({ text: "Before you record these marks", bold: true, size: 30 })],
                }),
                body(
                  `${review.length} of ${sorted.length} papers came back with something worth a second look. Open the original document and confirm the mark before it goes into your record book.`,
                  { size: 9.5, color: MUTED, after: 220 },
                ),
                ...review.map(
                  (student) =>
                    new Paragraph({
                      spacing: { after: 140, line: 264 },
                      children: [
                        new TextRun({ text: `${student.studentName} — ${mark(student.result.total)}/${mark(student.result.maxMarks)}  `, bold: true, size: 19 }),
                        new TextRun({
                          text:
                            student.result.flags.length > 0
                              ? student.result.flags.join("  ")
                              : `Marking confidence was ${student.result.confidence}.`,
                          size: 18,
                          color: MUTED,
                        }),
                      ],
                    }),
                ),
              ]
            : [
                new Paragraph({
                  pageBreakBefore: true,
                  spacing: { after: 120 },
                  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: HAIRLINE, space: 6 } },
                  children: [new TextRun({ text: "Before you record these marks", bold: true, size: 30 })],
                }),
                body("Every paper came back clear and confident. Nothing needs a second look.", {
                  size: 9.5,
                  color: MUTED,
                }),
              ]),
        ],
      },
    ],
  });

  return doc;
}

/**
 * Builds the report and hands back a Blob, so the caller only has to trigger a
 * download. Kept here so the browser and the preview script share one layout.
 */
export async function renderReport(input: ReportInput): Promise<Blob> {
  return Packer.toBlob(buildReport(input));
}

/** "markguide-grade-9-english-hl-narrative-essay-2026-11-06.docx" */
export function reportFilename(rubric: Rubric, date = new Date()): string {
  const slug =
    rubric.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "results";
  return `markguide-${slug}-${date.toISOString().slice(0, 10)}.docx`;
}
