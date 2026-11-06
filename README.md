# MarkGuide

A phone-first marking assistant for teachers. Upload your marking guide, add your students' work,
and get every paper marked against your own criteria — with a reason behind each mark.

Built with Next.js (App Router) and the Gemini API. No database, no accounts: a batch lives in the
browser tab and disappears when you close it.

---

## How it works

1. **Upload the marking guide** — a PDF or a photo of a memo, answer key or rubric (up to 3 files).
2. **Gemini reads the guide** and extracts the criteria, the marks for each, and how partial credit
   works. You see all of it before anything is marked, and can rescan if it looks wrong.
3. **Add student documents** — one PDF or photo per student, up to 25 at a time. Photos are
   downscaled in the browser before upload so a phone camera picture becomes a fast ~300 KB request.
4. **Each paper is marked on its own** against the extracted rubric, two at a time, with live
   progress. Every mark comes back with the words in the paper that earned it, so the teacher
   checks the evidence instead of taking the total on trust. Every mark comes back with the words in the paper that earned it, so the teacher
   checks the evidence instead of taking the total on trust.
5. **Review the results** — class average, highest and lowest, a per-criterion breakdown showing
   the guide's wording, the quoted evidence and the reason behind each mark, flags for papers that
   need a human eye, and a Word report you can print or file.

Marks are always computed server-side from the per-criterion marks, so a student's total can never
disagree with their breakdown.

---

## Run it locally

```bash
npm install
cp .env.example .env.local   # then paste your key
npm run dev
```

Open http://localhost:3000.

### Getting a Gemini key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey).
2. Create an API key (the free tier is enough to try this out).
3. Put it in `.env.local`:

```bash
GEMINI_API_KEY=your-key-here
```

`GEMINI_MODEL` is optional and defaults to `gemini-2.5-flash`. Any multimodal Gemini model that
supports JSON schema output will work — `gemini-2.5-pro` gives sharper marking on dense subjects at
a higher cost and slower turnaround.

---

## Deploy to Vercel

```bash
npm i -g vercel
vercel
```

Then add the key in the dashboard: **Project → Settings → Environment Variables →
`GEMINI_API_KEY`** (Production, Preview and Development), and redeploy.

The API routes declare `maxDuration = 60`. That is available on Vercel's Hobby plan for these
routes; if you are on an older plan, lower it to `10` and expect slower marking on long papers.

---

## Design notes

The interface follows Apple's [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines):

- **Mobile first.** Everything is laid out for a 390 pt phone, then centred in a 640 px column on
  desktop. Primary actions sit in a bottom bar above the home indicator, sized at least 44 × 44 pt.
- **Grouped inset lists** on `systemGroupedBackground`, with hairline separators and 12 pt radii.
- **System type and colour.** SF Pro via the platform font stack, iOS system colours, and automatic
  light/dark mode through `prefers-color-scheme`.
- **One decision per screen**, a persistent step indicator, and plain-language copy instead of
  jargon — the teacher always knows what is happening and what to do next.
- **Motion respects `prefers-reduced-motion`**, and focus rings are visible for keyboard users.

---

## Project layout

```
app/
  page.tsx                  the whole guided flow (client component)
  layout.tsx                metadata, viewport, safe-area setup
  globals.css               design tokens + every component style
  api/analyze-guide/route   guide -> rubric (Gemini, JSON schema)
  api/mark/route            one student document -> marks (Gemini, JSON schema)
components/
  RubricReview.tsx          "here's what we'll mark" screen
  ResultsView.tsx           summary, per-student breakdown, report export
  Icons.tsx, Spinner.tsx    inline SVG icon set, iOS activity indicator
lib/
  report.ts                 the Word report: layout, styles, filename
  gemini.ts                 prompts, response schemas, retries, normalisation
  client.ts                 image compression, base64, fetch wrapper, downloads
  validate.ts               request parsing and size guards
  types.ts, constants.ts    shared types and limits
```

## Limits

- 3 MB per file, 3 MB combined for the marking guide. This is the Vercel serverless request body
  cap (4.5 MB) minus base64 overhead.
- 25 student documents per batch, 2 marked concurrently to stay clear of Gemini rate limits.
- Files are sent to Gemini for marking and are not stored anywhere by this app.
