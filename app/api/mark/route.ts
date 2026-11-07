import { NextResponse } from "next/server";

import { AIError, activeModel } from "@/lib/ai";
import { markDocument } from "@/lib/marking";
import { RequestError, parseFile, parseRubric } from "@/lib/validate";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const started = Date.now();

  try {
    const body = (await request.json()) as {
      rubric?: unknown;
      student?: unknown;
      studentName?: unknown;
    };

    const rubric = parseRubric(body.rubric);
    const student = parseFile(body.student, "student document");
    const studentName =
      typeof body.studentName === "string" && body.studentName.trim()
        ? body.studentName.trim().slice(0, 120)
        : "Student";

    const result = await markDocument(rubric, student, studentName);

    return NextResponse.json({
      result: { ...result, durationMs: Date.now() - started, model: activeModel() },
    });
  } catch (error) {
    if (error instanceof RequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AIError) {
      return NextResponse.json({ error: error.message, detail: error.detail }, { status: error.status });
    }

    console.error("[mark] unexpected", error);
    return NextResponse.json(
      { error: "Something went wrong while marking that document. Please try again." },
      { status: 500 },
    );
  }
}
