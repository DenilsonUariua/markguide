"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ArrowRight,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  DocIcon,
  GuideIcon,
  Info,
  Plus,
  Sparkle,
  Warning,
  X,
} from "@/components/Icons";
import { ResultsView } from "@/components/ResultsView";
import { RubricReview } from "@/components/RubricReview";
import { Spinner } from "@/components/Spinner";
import { UploadError, postJson, prepareFile } from "@/lib/client";
import {
  MARK_CONCURRENCY,
  MAX_GUIDE_FILES,
  MAX_GUIDE_TOTAL_BYTES,
  MAX_STUDENT_FILES,
  formatBytes,
  formatMark,
  formatPercent,
  nameFromFileName,
} from "@/lib/constants";
import type { MarkResult, Rubric, StudentDoc, UploadedFile } from "@/lib/types";

type Step = "guide" | "rubric" | "students" | "marking" | "results";
type Zone = "guide" | "students" | null;

const STEP_NUMBER: Record<Step, number> = {
  guide: 1,
  rubric: 1,
  students: 2,
  marking: 3,
  results: 3,
};

const NAV_TITLE: Record<Step, string> = {
  guide: "MarkGuide",
  rubric: "Marking guide",
  students: "Student work",
  marking: "Marking",
  results: "Results",
};

const STEP_LABEL: Record<Step, string> = {
  guide: "Marking guide",
  rubric: "Marking guide",
  students: "Student work",
  marking: "Marking",
  results: "Results",
};

const ANALYSING_MESSAGES = [
  "Reading your marking guide…",
  "Finding the criteria…",
  "Checking the mark allocations…",
  "Working out how marks are awarded…",
];

export default function Page() {
  const [step, setStep] = useState<Step>("guide");
  const [scrolled, setScrolled] = useState(false);

  const [guideFiles, setGuideFiles] = useState<UploadedFile[]>([]);
  const [rubric, setRubric] = useState<Rubric | null>(null);
  const [students, setStudents] = useState<StudentDoc[]>([]);

  const [zone, setZone] = useState<Zone>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [messageIndex, setMessageIndex] = useState(0);

  const guideInput = useRef<HTMLInputElement>(null);
  const studentInput = useRef<HTMLInputElement>(null);

  /* ---------------------------------------------------------------- */
  /* Chrome                                                            */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 36);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    setNotice(null);
  }, [step]);

  useEffect(() => {
    if (!analyzing) return;
    const timer = setInterval(
      () => setMessageIndex((index) => (index + 1) % ANALYSING_MESSAGES.length),
      2400,
    );
    return () => clearInterval(timer);
  }, [analyzing]);

  useEffect(() => {
    if (step !== "marking") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [step]);

  const allSettled =
    students.length > 0 &&
    students.every((student) => student.status === "done" || student.status === "error");

  /* ---------------------------------------------------------------- */
  /* Files                                                             */
  /* ---------------------------------------------------------------- */

  const addGuideFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      setZone("guide");
      setNotice(null);

      try {
        const prepared: UploadedFile[] = [];
        for (const file of Array.from(fileList)) {
          prepared.push(await prepareFile(file));
        }

        const accepted: UploadedFile[] = [];
        let total = guideFiles.reduce((sum, file) => sum + file.sizeBytes, 0);
        let warning: string | null = null;

        for (const file of prepared) {
          if (guideFiles.length + accepted.length >= MAX_GUIDE_FILES) {
            warning = `A marking guide can be up to ${MAX_GUIDE_FILES} files. Remove one to add another.`;
            break;
          }
          if (total + file.sizeBytes > MAX_GUIDE_TOTAL_BYTES) {
            warning = "Those pages add up to more than 3 MB. Try a smaller scan or one page at a time.";
            break;
          }
          accepted.push(file);
          total += file.sizeBytes;
        }

        setGuideFiles((prev) => [...prev, ...accepted]);
        if (warning) setNotice(warning);
      } catch (error) {
        setNotice(error instanceof UploadError ? error.message : "That file could not be added.");
      } finally {
        setZone(null);
      }
    },
    [guideFiles],
  );

  const addStudentFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      setZone("students");
      setNotice(null);

      try {
        const prepared: UploadedFile[] = [];
        for (const file of Array.from(fileList)) {
          prepared.push(await prepareFile(file));
        }

        const room = MAX_STUDENT_FILES - students.length;
        const slice = prepared.slice(0, Math.max(0, room));

        setStudents((prev) => [
          ...prev,
          ...slice.map((file) => ({
            file,
            studentName: nameFromFileName(file.name),
            status: "queued" as const,
          })),
        ]);

        if (prepared.length > slice.length) {
          setNotice(
            `Only ${MAX_STUDENT_FILES} documents fit in one batch. Mark this set first, then add the rest.`,
          );
        }
      } catch (error) {
        setNotice(error instanceof UploadError ? error.message : "That file could not be added.");
      } finally {
        setZone(null);
      }
    },
    [students.length],
  );

  const removeGuideFile = (id: string) => {
    setGuideFiles((prev) => {
      const target = prev.find((file) => file.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((file) => file.id !== id);
    });
    setRubric(null);
  };

  const removeStudent = (id: string) => {
    setStudents((prev) => {
      const target = prev.find((student) => student.file.id === id);
      if (target?.file.previewUrl) URL.revokeObjectURL(target.file.previewUrl);
      return prev.filter((student) => student.file.id !== id);
    });
  };

  const renameStudent = (id: string, name: string) => {
    setStudents((prev) =>
      prev.map((student) => (student.file.id === id ? { ...student, studentName: name } : student)),
    );
  };

  /* ---------------------------------------------------------------- */
  /* Guide analysis                                                    */
  /* ---------------------------------------------------------------- */

  const analyseGuide = useCallback(async () => {
    setStep("rubric");
    setAnalyzing(true);
    setAnalyzeError(null);
    setRubric(null);
    setMessageIndex(0);

    try {
      const { rubric: parsed } = await postJson<{ rubric: Rubric }>("/api/analyze-guide", {
        files: guideFiles.map((file) => ({ mimeType: file.mimeType, data: file.data })),
      });
      setRubric(parsed);
    } catch (error) {
      setAnalyzeError(
        error instanceof Error ? error.message : "The guide could not be read. Please try again.",
      );
    } finally {
      setAnalyzing(false);
    }
  }, [guideFiles]);

  /* ---------------------------------------------------------------- */
  /* Marking                                                           */
  /* ---------------------------------------------------------------- */

  const markAll = useCallback(
    async (targets: StudentDoc[]) => {
      if (!rubric || targets.length === 0) return;
      setStep("marking");

      let cursor = 0;

      const worker = async () => {
        while (cursor < targets.length) {
          const item = targets[cursor++];

          setStudents((prev) =>
            prev.map((student) =>
              student.file.id === item.file.id
                ? { ...student, status: "marking", error: undefined }
                : student,
            ),
          );

          try {
            const { result } = await postJson<{ result: MarkResult }>("/api/mark", {
              rubric,
              student: { mimeType: item.file.mimeType, data: item.file.data },
              studentName: item.studentName || "Student",
            });

            setStudents((prev) =>
              prev.map((student) =>
                student.file.id === item.file.id ? { ...student, status: "done", result } : student,
              ),
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : "Marking failed.";
            setStudents((prev) =>
              prev.map((student) =>
                student.file.id === item.file.id
                  ? { ...student, status: "error", error: message }
                  : student,
              ),
            );
          }
        }
      };

      await Promise.all(Array.from({ length: MARK_CONCURRENCY }, worker));
    },
    [rubric],
  );

  const pending = students.filter(
    (student) => student.status === "queued" || student.status === "error",
  );
  const failed = students.filter((student) => student.status === "error");
  const doneCount = students.filter((student) => student.status === "done").length;

  const reset = () => {
    [...guideFiles, ...students.map((student) => student.file)].forEach((file) => {
      if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
    });
    setGuideFiles([]);
    setStudents([]);
    setRubric(null);
    setAnalyzeError(null);
    setStep("guide");
  };

  /* ---------------------------------------------------------------- */
  /* Nav                                                               */
  /* ---------------------------------------------------------------- */

  const back = () => {
    if (step === "rubric") setStep("guide");
    else if (step === "students") setStep("rubric");
    else if (step === "results") setStep("students");
  };

  const canGoBack = step === "rubric" || step === "students" || step === "results";
  const stepNumber = STEP_NUMBER[step];

  return (
    <div className="shell">
      <header className="nav">
        <div className="nav-inner">
          {canGoBack ? (
            <button className="nav-back" onClick={back} aria-label="Go back">
              <ChevronLeft size={22} />
              Back
            </button>
          ) : (
            <span style={{ width: 44, height: 44 }} aria-hidden />
          )}
          <div className={`nav-title ${scrolled ? "is-visible" : ""}`}>{NAV_TITLE[step]}</div>
          <span style={{ width: 44, height: 44 }} aria-hidden />
        </div>
      </header>

      <main className="main has-cta">
        {step !== "results" ? (
          <div style={{ paddingTop: 8 }}>
            <div className="steps-label">
              Step {stepNumber} of 3 · {STEP_LABEL[step]}
            </div>
            <div className="steps" aria-hidden>
              {[1, 2, 3].map((index) => (
                <span
                  key={index}
                  className={`step-dot ${index <= stepNumber ? "is-done" : ""}`}
                />
              ))}
            </div>
          </div>
        ) : null}

        {notice ? (
          <div className="alert alert-warn" style={{ marginTop: 16 }} role="status">
            <Warning size={18} />
            <div style={{ flex: 1 }}>{notice}</div>
            <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => setNotice(null)}>
              <X size={16} />
            </button>
          </div>
        ) : null}

        {/* ---------------------------------------------------------- */}
        {/* Step 1 — marking guide                                     */}
        {/* ---------------------------------------------------------- */}
        {step === "guide" ? (
          <div className="fade-up">
            <h1 className="large-title">Mark a batch</h1>
            <p className="subtitle">
              Add your marking guide, then your students&apos; work. Every paper comes back marked
              against your own criteria — with a reason for each mark.
            </p>

            <h2 className="section-header">
              <span>Marking guide</span>
              {guideFiles.length > 0 ? <span>{guideFiles.length} added</span> : null}
            </h2>

            <div className="card">
              <button className="dropzone" onClick={() => guideInput.current?.click()}>
                <span className="dropzone-icon">
                  {zone === "guide" ? <Spinner size={20} /> : <Plus size={24} />}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="dropzone-title" style={{ display: "block" }}>
                    {guideFiles.length === 0 ? "Add marking guide" : "Add another page"}
                  </span>
                  <span className="dropzone-sub">
                    {zone === "guide" ? "Preparing…" : "PDF or photo · up to 3 files"}
                  </span>
                </span>
                <ChevronRight className="chevron" size={17} />
              </button>

              {guideFiles.map((file) => (
                <div className="file-row" key={file.id}>
                  <span className="file-thumb">
                    {file.previewUrl ? (
                      <img src={file.previewUrl} alt="" />
                    ) : (
                      <DocIcon size={18} />
                    )}
                  </span>
                  <span className="row-main">
                    <span className="row-title truncate" style={{ display: "block" }}>
                      {file.name}
                    </span>
                    <span className="row-sub" style={{ display: "block" }}>
                      {file.kind === "pdf" ? "PDF" : "Photo"} · {formatBytes(file.sizeBytes)}
                    </span>
                  </span>
                  <button
                    className="icon-btn danger"
                    onClick={() => removeGuideFile(file.id)}
                    aria-label={`Remove ${file.name}`}
                  >
                    <X size={18} />
                  </button>
                </div>
              ))}
            </div>

            <div className="callout" style={{ marginTop: 12 }}>
              <Info size={16} className="callout-icon" />
              <span>
                A clear guide means accurate marks. Make sure the marks per question — and any memo
                answers — are readable in the scan.
              </span>
            </div>

            <h2 className="section-header">
              <span>How this works</span>
            </h2>
            <div className="card">
              <div className="how-step">
                <span className="how-num">1</span>
                <div>
                  <div className="how-title">Upload your guide</div>
                  <div className="how-sub">
                    We read the criteria and mark allocations from it — you can check them before
                    anything is marked.
                  </div>
                </div>
              </div>
              <div className="how-step">
                <span className="how-num">2</span>
                <div>
                  <div className="how-title">Add student work</div>
                  <div className="how-sub">
                    One PDF or photo per student. Take photos with your camera if that&apos;s easier.
                  </div>
                </div>
              </div>
              <div className="how-step">
                <span className="how-num">3</span>
                <div>
                  <div className="how-title">Review the marks</div>
                  <div className="how-sub">
                    See each paper&apos;s marks, the reason behind them, and export everything to CSV.
                  </div>
                </div>
              </div>
            </div>

            <p className="footnote">
              Documents are sent to Google&apos;s Gemini API to be marked. Nothing is stored on this
              site — closing the tab clears your batch.
            </p>

            <div className="cta-bar">
              <div className="cta-inner">
                <button
                  className="btn btn-primary"
                  disabled={guideFiles.length === 0 || zone === "guide"}
                  onClick={analyseGuide}
                >
                  {analyzing ? (
                    <>
                      <Spinner size={18} /> Reading guide…
                    </>
                  ) : (
                    <>
                      Continue
                      <ArrowRight size={19} />
                    </>
                  )}
                </button>
                <p className="cta-hint">Next: we&apos;ll show you the criteria we found.</p>
              </div>
            </div>
          </div>
        ) : null}

        {/* ---------------------------------------------------------- */}
        {/* Step 1b — rubric review                                    */}
        {/* ---------------------------------------------------------- */}
        {step === "rubric" ? (
          <div style={{ paddingTop: 12 }}>
            {analyzing ? (
              <div className="card fade-in">
                <div className="loading-panel">
                  <Spinner size={28} />
                  <div>
                    <div className="loading-title">{ANALYSING_MESSAGES[messageIndex]}</div>
                    <div className="loading-sub" style={{ marginTop: 4 }}>
                      This usually takes a few seconds.
                    </div>
                  </div>
                </div>
                <div style={{ padding: "0 16px 20px" }}>
                  <div className="skeleton" style={{ width: "60%" }} />
                  <div className="skeleton" style={{ width: "85%", marginTop: 10 }} />
                  <div className="skeleton" style={{ width: "72%", marginTop: 10 }} />
                </div>
              </div>
            ) : analyzeError ? (
              <div className="fade-in" style={{ paddingTop: 20 }}>
                <h1 className="large-title">Couldn&apos;t read that guide</h1>
                <div className="alert alert-error" style={{ marginTop: 8 }}>
                  <Warning size={18} />
                  <div>{analyzeError}</div>
                </div>
                <div className="card card-padded">
                  <div className="row-title" style={{ marginBottom: 6 }}>
                    Things that usually fix it
                  </div>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: 18,
                      fontSize: 14,
                      lineHeight: 1.5,
                      color: "var(--label-secondary)",
                    }}
                  >
                    <li>Scan or photograph the whole page, including the mark allocations.</li>
                    <li>Make sure the text is sharp and the page isn&apos;t cut off.</li>
                    <li>If the guide is long, upload the page with the rubric first.</li>
                  </ul>
                </div>
                <div style={{ height: 16 }} />
                <button className="btn btn-primary" onClick={analyseGuide}>
                  Try again
                </button>
                <div style={{ height: 8 }} />
                <button className="btn btn-ghost" onClick={() => setStep("guide")}>
                  Change the file
                </button>
              </div>
            ) : rubric ? (
              <RubricReview
                rubric={rubric}
                onContinue={() => setStep("students")}
                onRescan={analyseGuide}
              />
            ) : null}
          </div>
        ) : null}

        {/* ---------------------------------------------------------- */}
        {/* Step 2 — student documents                                 */}
        {/* ---------------------------------------------------------- */}
        {step === "students" ? (
          <div className="fade-up">
            <h1 className="large-title">Add student work</h1>
            <p className="subtitle">
              One document per student. Photos are fine — we shrink them before sending so they
              upload quickly.
            </p>

            {rubric ? (
              <div className="card" style={{ marginBottom: 4 }}>
                <div className="row">
                  <span className="glyph is-green">
                    <Check size={17} />
                  </span>
                  <div className="row-main">
                    <div className="row-title truncate">{rubric.title}</div>
                    <div className="row-sub">
                      {rubric.criteria.length} criteria · {formatMark(rubric.totalMarks)} marks
                    </div>
                  </div>
                  <button className="btn btn-sm btn-tinted" onClick={() => setStep("rubric")}>
                    View
                  </button>
                </div>
              </div>
            ) : null}

            <h2 className="section-header">
              <span>Documents</span>
              {students.length > 0 ? (
                <span>
                  {students.length} of {MAX_STUDENT_FILES}
                </span>
              ) : null}
            </h2>

            <div className="card">
              <button className="dropzone" onClick={() => studentInput.current?.click()}>
                <span className="dropzone-icon">
                  {zone === "students" ? <Spinner size={20} /> : <Camera size={22} />}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="dropzone-title" style={{ display: "block" }}>
                    {students.length === 0 ? "Add student documents" : "Add more documents"}
                  </span>
                  <span className="dropzone-sub">
                    {zone === "students"
                      ? "Preparing…"
                      : "PDF or photo · select as many as you like"}
                  </span>
                </span>
                <ChevronRight className="chevron" size={17} />
              </button>

              {students.map((student, index) => (
                <div className="file-row" key={student.file.id}>
                  <span className="file-thumb">
                    {student.file.previewUrl ? (
                      <img src={student.file.previewUrl} alt="" />
                    ) : (
                      <DocIcon size={18} />
                    )}
                  </span>
                  <span className="row-main" style={{ minWidth: 0 }}>
                    <label className="sr-only" htmlFor={`name-${student.file.id}`}>
                      Student name for document {index + 1}
                    </label>
                    <input
                      id={`name-${student.file.id}`}
                      className="input input-inline"
                      value={student.studentName}
                      onChange={(event) => renameStudent(student.file.id, event.target.value)}
                      onBlur={(event) =>
                        renameStudent(
                          student.file.id,
                          event.target.value.trim() || `Student ${index + 1}`,
                        )
                      }
                      enterKeyHint="done"
                      placeholder={`Student ${index + 1}`}
                      style={{ width: "100%" }}
                    />
                    <span className="row-sub" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      {student.status === "done" && student.result ? (
                        <>
                          <Check size={13} style={{ color: "var(--green)" }} />
                          {formatMark(student.result.total)}/{formatMark(student.result.maxMarks)} ·{" "}
                          {formatPercent(student.result.percentage)}
                        </>
                      ) : student.status === "error" ? (
                        <span style={{ color: "var(--red)" }}>Not marked — will retry</span>
                      ) : (
                        <>
                          {student.file.kind === "pdf" ? "PDF" : "Photo"} ·{" "}
                          {formatBytes(student.file.sizeBytes)}
                        </>
                      )}
                    </span>
                  </span>
                  <button
                    className="icon-btn danger"
                    onClick={() => removeStudent(student.file.id)}
                    aria-label={`Remove ${student.studentName}`}
                  >
                    <X size={18} />
                  </button>
                </div>
              ))}
            </div>

            {students.length === 0 ? (
              <div className="callout" style={{ marginTop: 12 }}>
                <Sparkle size={16} className="callout-icon" />
                <span>
                  Name each file after the student and the names come through automatically — you can
                  edit them before marking.
                </span>
              </div>
            ) : null}

            <div className="cta-bar">
              <div className="cta-inner">
                <button
                  className="btn btn-primary"
                  disabled={pending.length === 0 || zone === "students" || !rubric}
                  onClick={() => markAll(pending)}
                >
                  {pending.length === 0
                    ? "Add a document to mark"
                    : `Mark ${pending.length} ${pending.length === 1 ? "document" : "documents"}`}
                  {pending.length > 0 ? <ArrowRight size={19} /> : null}
                </button>
                <p className="cta-hint">
                  Marks come only from what&apos;s visible in each document.
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {/* ---------------------------------------------------------- */}
        {/* Step 3 — marking progress                                  */}
        {/* ---------------------------------------------------------- */}
        {step === "marking" ? (
          <div className="fade-up">
            <h1 className="large-title">
              {allSettled ? (failed.length > 0 ? "Nearly there" : "All marked") : "Marking…"}
            </h1>
            <p className="subtitle">
              {allSettled
                ? failed.length > 0
                  ? "A few papers didn't come back. You can retry them or carry on with the rest."
                  : "Every paper is marked. Here's the quick look before the full breakdown."
                : "Each paper is read and marked in turn. Keep this screen open — it takes about 20 seconds a paper."}
            </p>

            <div className="card">
              <div className="card-padded">
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    marginBottom: 9,
                  }}
                >
                  <span style={{ fontSize: 15, fontWeight: 600 }}>
                    {doneCount} of {students.length} marked
                  </span>
                  <span className="caption tabular" aria-live="polite">
                    {students.length > 0
                      ? formatPercent((doneCount / students.length) * 100)
                      : "0%"}
                  </span>
                </div>
                <div className="progress">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${students.length > 0 ? (doneCount / students.length) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {failed.length > 0 && allSettled ? (
              <div className="alert alert-error" style={{ marginTop: 12 }}>
                <Warning size={18} />
                <div style={{ flex: 1 }}>
                  <strong>
                    {failed.length} {failed.length === 1 ? "paper" : "papers"} failed.
                  </strong>{" "}
                  {failed[0].error}
                </div>
              </div>
            ) : null}

            <h2 className="section-header">
              <span>Papers</span>
            </h2>
            <div className="card">
              {students.map((student) => (
                <div className="row" key={student.file.id}>
                  <span
                    className="glyph"
                    style={
                      student.status === "done"
                        ? { background: "var(--green)", color: "#fff" }
                        : student.status === "error"
                          ? { background: "var(--red)", color: "#fff" }
                          : student.status === "marking"
                            ? { background: "var(--blue-soft)", color: "var(--blue)" }
                            : {
                                background: "var(--fill-tertiary)",
                                color: "var(--label-secondary)",
                              }
                    }
                  >
                    {student.status === "done" ? (
                      <Check size={17} />
                    ) : student.status === "error" ? (
                      <Warning size={16} />
                    ) : student.status === "marking" ? (
                      <Spinner size={16} />
                    ) : (
                      <DocIcon size={16} />
                    )}
                  </span>
                  <div className="row-main" style={{ minWidth: 0 }}>
                    <div className="row-title truncate">{student.studentName}</div>
                    <div className="row-sub">
                      {student.status === "marking"
                        ? "Reading and marking…"
                        : student.status === "queued"
                          ? "Waiting"
                          : student.status === "error"
                            ? "Could not be marked"
                            : `${formatMark(student.result?.total ?? 0)} of ${formatMark(student.result?.maxMarks ?? 0)} marks`}
                    </div>
                  </div>
                  {student.status === "done" && student.result ? (
                    <span
                      className={`badge ${
                        student.result.percentage >= 70
                          ? "badge-green"
                          : student.result.percentage >= 50
                            ? "badge-orange"
                            : "badge-red"
                      }`}
                    >
                      {formatPercent(student.result.percentage)}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="cta-bar">
              <div className="cta-inner">
                {failed.length > 0 && allSettled ? (
                  <>
                    <button className="btn btn-primary" onClick={() => markAll(failed)}>
                      Retry {failed.length} {failed.length === 1 ? "paper" : "papers"}
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => setStep("results")}
                      disabled={doneCount === 0}
                    >
                      Skip and see the {doneCount} marked
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn btn-primary"
                      disabled={!allSettled}
                      onClick={() => setStep("results")}
                    >
                      {allSettled ? (
                        <>
                          See results
                          <ArrowRight size={19} />
                        </>
                      ) : (
                        <>
                          <Spinner size={18} /> Marking…
                        </>
                      )}
                    </button>
                    <p className="cta-hint">
                      {allSettled
                        ? "Marks and comments are ready."
                        : `${students.length - doneCount} ${students.length - doneCount === 1 ? "paper" : "papers"} to go.`}
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {/* ---------------------------------------------------------- */}
        {/* Step 4 — results                                           */}
        {/* ---------------------------------------------------------- */}
        {step === "results" && rubric ? (
          <ResultsView
            rubric={rubric}
            students={students}
            onRestart={reset}
            onAddMore={() => setStep("students")}
            onRetryFailed={() => markAll(failed)}
          />
        ) : null}

        <input
          ref={guideInput}
          type="file"
          accept="application/pdf,image/*"
          multiple
          hidden
          onChange={(event) => {
            void addGuideFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <input
          ref={studentInput}
          type="file"
          accept="application/pdf,image/*"
          multiple
          hidden
          onChange={(event) => {
            void addStudentFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </main>
    </div>
  );
}
