"use client";

import { Check, GuideIcon, Sparkle } from "@/components/Icons";
import { formatMark } from "@/lib/constants";
import type { Rubric } from "@/lib/types";

interface Props {
  rubric: Rubric;
  onContinue: () => void;
  onRescan: () => void;
}

export function RubricReview({ rubric, onContinue, onRescan }: Props) {
  const total = rubric.criteria.reduce((sum, c) => sum + c.maxMarks, 0);

  return (
    <div className="fade-up">
      <h1 className="large-title">Here&apos;s what we&apos;ll mark</h1>
      <p className="subtitle">
        Read from your guide. Check the criteria and marks look right — this is exactly what every
        paper is marked against.
      </p>

      <div className="card">
        <div className="card-padded" style={{ paddingBottom: 14 }}>
          <div
            className="caption"
            style={{ textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}
          >
            {rubric.subject || "Marking guide"}
          </div>
          <div className="title-2" style={{ marginTop: 4 }}>
            {rubric.title}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 10,
              flexWrap: "wrap",
            }}
          >
            <span className="badge badge-blue">{formatMark(total)} marks</span>
            <span className="badge badge-grey">
              {rubric.criteria.length} {rubric.criteria.length === 1 ? "criterion" : "criteria"}
            </span>
          </div>
        </div>

        <div style={{ height: "0.5px", background: "var(--separator)" }} />

        {rubric.criteria.map((criterion, index) => (
          <div className="criteria-row" key={`${criterion.name}-${index}`}>
            <div className="criteria-head">
              <span className="criteria-name">
                <span style={{ color: "var(--label-tertiary)", marginRight: 6 }}>{index + 1}.</span>
                {criterion.name}
              </span>
              <span className="criteria-mark">
                {formatMark(criterion.maxMarks)}
                <span className="unit">marks</span>
              </span>
            </div>
            {criterion.description ? (
              <p className="criteria-comment">{criterion.description}</p>
            ) : null}
          </div>
        ))}
      </div>

      {rubric.gradingNotes ? (
        <>
          <h2 className="section-header">
            <span>How marks are awarded</span>
          </h2>
          <div className="card card-padded">
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45, color: "var(--label)" }}>
              {rubric.gradingNotes}
            </p>
          </div>
        </>
      ) : null}

      <h2 className="section-header">
        <span>What happens next</span>
      </h2>
      <div className="card">
        <div className="row">
          <span className="glyph is-green">
            <Check size={17} />
          </span>
          <div className="row-main">
            <div className="row-title">Each paper is read on its own</div>
            <div className="row-sub">
              Marks are awarded only for work that is visible in that student&apos;s document.
            </div>
          </div>
        </div>
        <div className="row">
          <span className="glyph is-purple">
            <Sparkle size={17} />
          </span>
          <div className="row-main">
            <div className="row-title">You get a mark and a reason</div>
            <div className="row-sub">
              Every criterion comes back with the mark awarded and a one-line comment.
            </div>
          </div>
        </div>
      </div>

      <p className="footnote">
        Not right? Rescanning re-reads the guide — useful if a page was missing or the scan was
        unclear.
      </p>

      <div style={{ height: 8 }} />

      <div className="cta-bar">
        <div className="cta-inner">
          <button className="btn btn-primary" onClick={onContinue}>
            <GuideIcon size={19} />
            Looks right — add student work
          </button>
          <button className="btn btn-ghost" onClick={onRescan}>
            Read the guide again
          </button>
        </div>
      </div>
    </div>
  );
}
