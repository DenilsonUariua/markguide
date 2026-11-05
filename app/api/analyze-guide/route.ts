import { NextResponse } from "next/server";

import { GeminiError, analyzeGuide } from "@/lib/gemini";
import { RequestError, parseGuideFiles } from "@/lib/validate";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { files?: unknown };
    const files = parseGuideFiles(body.files);

    const rubric = await analyzeGuide(files);

    return NextResponse.json({ rubric });
  } catch (error) {
    if (error instanceof RequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof GeminiError) {
      return NextResponse.json({ error: error.message, detail: error.detail }, { status: error.status });
    }

    console.error("[analyze-guide] unexpected", error);
    return NextResponse.json(
      { error: "Something went wrong while reading the marking guide. Please try again." },
      { status: 500 },
    );
  }
}
