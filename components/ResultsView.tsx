"use client";

import { useMemo, useState } from "react";

import { ChevronRight, Download, Info, Warning } from "@/components/Icons";
import { downloadCsv } from "@/lib/client";
import { formatMark, formatPercent } from "@/lib/constants";
import type { MarkResult, Rubric, StudentDoc } from "@/lib/types";

interface Props {
  rubric: Rubric;
  students: StudentDoc[];
  onRestart: () => void;
  onAddMore: () => void;
  onRetryFailed: () => void;
}

type Filter = "all" | "review";

function toneFor(percentage: number): string {
  if (percentage >= 70) return "badge-green";
  if (percentage >= 50) return "badge-orange";
  return "badge-red";
}

function needsReview(student: StudentDoc): boolean {
  if (!student.result) return false;
  return (
    student.result.flags.length > 0 ||
    student.result.confidence !== "high" ||
    student.result.percentage < 40
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export function ResultsView({ rubric, students, onRestart, onAddMore, onRetryFailed }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const marked = useMemo(() => students.filter((s) => s.status === "done" && s.result), [students]);
  const failed = useMemo(() => students.filter((s) => s.status === "error"), [students]);
  const reviewCount = useMemo(() => marked.filter(needsReview).length, [marked]);

  const stats = useMemo(() => {
    if (marked.length === 0) return null;
    const percentages = marked.map((s) => s.result!.percentage);
    const average = percentages.reduce((a, b) => a + b, 0) / percentages.length;
    const totalMs = marked.reduce((sum, s) => sum + (s.result?.durationMs ?? 0), 0);
    const averageMarks =
      marked.reduce((sum, s) => sum + (s.result?.total ?? 0), 0) / marked.length;
    return {
      average,
      averageMarks,
      maxMarks: marked[0].result?.maxMarks ?? 0,
      highest: Math.max(...percentages),
      lowest: Math.min(...percentages),
      totalMs,
      model: marked[0].result?.model ?? "Gemini",
    };
  }, [marked]);

  const visible = useMemo(() => {
    const list = filter === "review" ? marked.filter(needsReview) : marked;
    return [...list].sort((a, b) => b.result!.percentage - a.result!.percentage);
  }, [marked, filter]);

  const guideTotal = rubric.criteria.reduce((sum, c) => sum + c.maxMarks, 0);

  function exportCsv() {
    if (!stats) return;
    const header = [
      "Student",
      "Mark",
      "Out of",
      "%",
      ...rubric.criteria.map((c) => `${c.name} (/${formatMark(c.maxMarks)})`),
      "Overall comment",
      "Flags",
      "Confidence",
    ];

    const rows = [...marked]
      .sort((a, b) => a.studentName.localeCompare(b.studentName))
      .map((student) => {
        const result = student.result as MarkResult;
        return [
          student.studentName,
          formatMark(result.total),
          formatMark(result.maxMarks),
          String(Math.round(result.percentage)),
          ...rubric.criteria.map((criterion) => {
            const found = result.criteria.find((c) => c.name === criterion.name);
            return found ? formatMark(found.awarded) : "0";
          }),
          result.overallComment,
          result.flags.join(" | "),
          result.confidence,
        ];
      });

    const slug =
      rubric.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40) || "results";
    const date = new Date().toISOString().slice(0, 10);

    downloadCsv(`markguide-${slug}-${date}.csv`, [header, ...rows]);
  }

  if (!stats) {
    return (
      <div className="fade-up">
        <h1 className="large-title">No marks yet</h1>
        <p className="subtitle">
          Nothing came back from the marking run. Go back, check your documents, and try again.
        </p>
        <button className="btn btn-primary" onClick={onAddMore}>
          Back to documents
        </button>
      </div>
    );
  }

  return (
    <div className="fade-up">
      <h1 className="large-title">Results</h1>
      <p className="subtitle">
        {marked.length} {marked.length === 1 ? "paper" : "papers"} marked against{" "}
        <strong style={{ color: "var(--label)", fontWeight: 600 }}>{rubric.title}</strong>.
      </p>

      {failed.length > 0 ? (
        <div className="alert alert-error">
          <Warning size={18} />
          <div style={{ flex: 1 }}>
            <strong>
              {failed.length} {failed.length === 1 ? "paper" : "papers"} could not be marked.
            </strong>{" "}
            {failed[0].error}
            <div style={{ marginTop: 8 }}>
              <button className="btn btn-sm btn-plain" onClick={onRetryFailed}>
                Retry {failed.length === 1 ? "it" : "them"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card-padded">
          <div className="caption">Class average</div>
          <div className="hero-score">
            {formatPercent(stats.average)}
            <small>average</small>
          </div>
          <div className="bar" style={{ height: 6, marginTop: 12 }}>
            <div
              className={`bar-fill ${stats.average < 50 ? "is-low" : stats.average < 70 ? "is-mid" : ""}`}
              style={{ width: `${Math.max(2, Math.min(100, stats.average))}%` }}
            />
          </div>
          <div className="caption" style={{ marginTop: 8 }}>
            {formatMark(stats.averageMarks)} of {formatMark(stats.maxMarks)} marks on average
          </div>
        </div>

        <div className="stat-grid">
          <div className="stat">
            <div className="stat-value">{marked.length}</div>
            <div className="stat-label">Marked</div>
          </div>
          <div className="stat">
            <div className="stat-value">{formatPercent(stats.highest)}</div>
            <div className="stat-label">Highest</div>
          </div>
          <div className="stat">
            <div className="stat-value">{formatPercent(stats.lowest)}</div>
            <div className="stat-label">Lowest</div>
          </div>
        </div>
      </div>

      <h2 className="section-header">
        <span>How this was marked</span>
      </h2>
      <div className="card">
        <div className="row">
          <div className="row-main">
            <div className="row-title">Marking guide</div>
          </div>
          <div className="row-value truncate" style={{ maxWidth: 180 }}>
            {rubric.title}
          </div>
        </div>
        <div className="row">
          <div className="row-main">
            <div className="row-title">Criteria used</div>
          </div>
          <div className="row-value">
            {rubric.criteria.length} · {formatMark(guideTotal)} marks
          </div>
        </div>
        <div className="row">
          <div className="row-main">
            <div className="row-title">Marked with</div>
          </div>
          <div className="row-value mono" style={{ fontSize: 14 }}>
            {stats.model}
          </div>
        </div>
        <div className="row">
          <div className="row-main">
            <div className="row-title">Time taken</div>
          </div>
          <div className="row-value">{formatDuration(stats.totalMs)}</div>
        </div>
      </div>
      <p className="footnote">
        Each paper was read on its own and marked only on what is visible in that document. Tap a
        student to see the mark for every criterion and the reason behind it.
      </p>

      <h2 className="section-header">
        <span>Students</span>
        <span style={{ textTransform: "none", letterSpacing: 0 }}>
          {filter === "review" ? `${reviewCount} flagged` : `${marked.length} total`}
        </span>
      </h2>

      <div className="segmented" role="tablist" aria-label="Filter results">
        <button
          role="tab"
          aria-selected={filter === "all"}
          className={filter === "all" ? "is-selected" : ""}
          onClick={() => setFilter("all")}
        >
          All papers
        </button>
        <button
          role="tab"
          aria-selected={filter === "review"}
          className={filter === "review" ? "is-selected" : ""}
          onClick={() => setFilter("review")}
        >
          Needs a look{reviewCount > 0 ? ` · ${reviewCount}` : ""}
        </button>
      </div>

      <div className="card">
        {visible.length === 0 ? (
          <div className="card-padded" style={{ textAlign: "center", color: "var(--label-secondary)" }}>
            <p style={{ margin: 0, fontSize: 15 }}>
              Nothing flagged. Every paper came back clear and confident.
            </p>
          </div>
        ) : (
          visible.map((student) => {
            const result = student.result as MarkResult;
            const isOpen = openId === student.file.id;
            const flagged = needsReview(student);

            return (
              <div key={student.file.id}>
                <button
                  className="row disclosure"
                  onClick={() => setOpenId(isOpen ? null : student.file.id)}
                  aria-expanded={isOpen}
                >
                  <div className="row-main">
                    <div className="row-title truncate">{student.studentName}</div>
                    <div className="row-sub">
                      {formatMark(result.total)} of {formatMark(result.maxMarks)} marks
                      {flagged ? " · check this one" : ""}
                    </div>
                  </div>
                  <span className={`badge ${toneFor(result.percentage)}`}>
                    {formatPercent(result.percentage)}
                  </span>
                  <ChevronRight className={`chevron ${isOpen ? "is-open" : ""}`} size={17} />
                </button>

                {isOpen ? (
                  <div className="expanded">
                    {result.criteria.map((criterion, index) => {
                      const ratio = criterion.maxMarks > 0 ? criterion.awarded / criterion.maxMarks : 0;
                      return (
                        <div className="criteria-row" key={`${student.file.id}-${index}`}>
                          <div className="criteria-head">
                            <span className="criteria-name" style={{ fontSize: 14 }}>
                              {criterion.name}
                            </span>
                            <span className="criteria-mark" style={{ fontSize: 14 }}>
                              {formatMark(criterion.awarded)}/{formatMark(criterion.maxMarks)}
                            </span>
                          </div>
                          <div className="bar">
                            <div
                              className={`bar-fill ${ratio < 0.4 ? "is-low" : ratio < 0.7 ? "is-mid" : ""}`}
                              style={{ width: `${Math.max(2, Math.min(100, ratio * 100))}%` }}
                            />
                          </div>
                          <p className="criteria-comment">{criterion.comment}</p>
                        </div>
                      );
                    })}

                    <div style={{ padding: "14px 16px 16px" }}>
                      <div className="caption" style={{ marginBottom: 4, fontWeight: 600 }}>
                        Overall
                      </div>
                      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>
                        {result.overallComment}
                      </p>

                      {result.flags.length > 0 ? (
                        <div className="alert alert-warn" style={{ marginTop: 12, marginBottom: 0 }}>
                          <Warning size={17} />
                          <div>
                            {result.flags.map((flag, index) => (
                              <div key={index} style={{ marginTop: index === 0 ? 0 : 4 }}>
                                {flag}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          marginTop: 12,
                          color: "var(--label-secondary)",
                          fontSize: 12,
                        }}
                      >
                        <Info size={14} />
                        Marking confidence: {result.confidence}
                        {result.durationMs ? ` · ${formatDuration(result.durationMs)}` : ""}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <div style={{ height: 8 }} />

      <div className="cta-bar">
        <div className="cta-inner">
          <button className="btn btn-primary" onClick={exportCsv}>
            <Download size={19} />
            Download marks (CSV)
          </button>
          <div className="inline-actions">
            <button className="btn btn-tinted btn-sm" onClick={onAddMore} style={{ minHeight: 44 }}>
              Mark more papers
            </button>
            <button className="btn btn-plain btn-sm" onClick={onRestart} style={{ minHeight: 44 }}>
              New guide
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
