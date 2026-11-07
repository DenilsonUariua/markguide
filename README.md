# MarkGuide

A phone-first marking assistant for teachers. Upload your marking guide, add your students' work,
and get every paper marked against your own criteria — with a reason behind each mark.

Built with Next.js (App Router) and a swappable model provider — Gemini or OpenRouter. No
database, no accounts: a batch lives in the browser tab and disappears when you close it.

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

### Choosing a provider

One environment variable decides who marks the papers:

```bash
AI_PROVIDER=openrouter   # or gemini
```

Leave it out and the app uses whichever API key it finds — Gemini first, then OpenRouter.

#### Gemini

1. Go to [Google AI Studio](https://aistudio.google.com/apikey).
2. Create an API key (the free tier is enough to try this out).
3. Put it in `.env.local`:

```bash
GEMINI_API_KEY=your-key-here
```

`GEMINI_MODEL` is optional and defaults to `gemini-2.5-flash`. Any multimodal Gemini model that
supports JSON schema output will work — `gemini-2.5-pro` gives sharper marking on dense subjects at
a higher cost and slower turnaround.

#### OpenRouter

1. Create a key at [openrouter.ai/keys](https://openrouter.ai/keys).
2. Add it to `.env.local`:

```bash
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your-key-here
```

| Variable | Default | Notes |
| --- | --- | --- |
| `OPENROUTER_MODEL` | `google/gemini-2.5-flash` | Must read PDFs and images. Other good picks: `google/gemini-2.5-pro`, `openai/gpt-4.1`, `anthropic/claude-sonnet-4.5`. |
| `OPENROUTER_FALLBACK_MODEL` | `openrouter/free` | Tried when the primary fails outright — rate limit, no credit for PDFs, model delisted. Set to `""` to disable. |
| `OPENROUTER_REASONING` | model default | `none`, `minimal`, `low`, `medium` or `high`. `none` keeps a class set fast. |
| `OPENROUTER_APP_NAME` | `MarkGuide` | Attribution on your OpenRouter activity page. |
| `OPENROUTER_SITE_URL` | unset | Optional referer for the same page. |
| `AI_TIMEOUT_MS` | `55000` | Per-request timeout. Keep it under the route's `maxDuration`. |

PDFs are sent as `file` parts and photos as `image_url` data URLs. The app asks for a strict JSON
schema first and retries once in plain `json_object` mode if the model does not support structured
outputs, so cheaper models still work.

A request is tried against `OPENROUTER_MODEL` first. If that fails in a way a second model can fix
— `429`, `402` (no credit for PDFs), `404` (model gone), or an upstream error — the same request is
re-sent to `OPENROUTER_FALLBACK_MODEL`. Timeouts are *not* retried server-side, because a 55 s
timeout leaves nothing of the 60 s function budget; those are retried in the browser instead.

> **PDFs need credit on paid models.** PDF parsing is gated behind a **$0.50 minimum balance** on
> paid models; below that, PDF uploads come back `402` and the free fallback picks them up. Top up at
> [openrouter.ai/settings/credits](https://openrouter.ai/settings/credits) to use PDFs on a paid model.

#### Free models

`openrouter/free` routes each request across OpenRouter's free models. It costs nothing, reads PDFs
and photos, and supports structured output. Because the routed model changes per request, marks
across a class set are not perfectly consistent, so it is used as the fallback by default.

The free multimodal models were benchmarked on the same two papers — a typed PDF memo and two
handwritten answer sheets with known correct marks:

| Model | Rubric from PDF | Marks (paper 1) | Marks (paper 2) | Speed |
| --- | --- | --- | --- | --- |
| `dots-studio/dots-3-note-preview:free` | ✅ 10/10 marks | 6/10 (defensible) | **7/10, exactly right** | 45–47 s |
| `nvidia/nemotron-3.5-super-vl:free` | ✅ 10/10 marks | 6/10 | timed out | 37 s, unstable |
| `openrouter/free` (router) | ✅ 10/10 marks | timed out | — | 20–55 s |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | ✅ | 5/10 (marked correct work wrong) | — | 46 s |
| `stealth/crouton-alpha` | ❌ `402` on PDFs | 6/10 | — | 30 s |
| `google/gemma-4-31b-it:free` | ❌ `429` | ❌ `429` | ❌ `429` | — |
| `google/gemma-4-26b-a4b-it:free` | ❌ `429` | ❌ `429` | — | — |

`dots-studio/dots-3-note-preview:free` is the best free pick: it was the only model to award a
paper perfectly, it quoted the student's own words as evidence, and it never errored. Everything
free is slow though (45 s+ per paper), so a 25-paper batch takes about 10 minutes and a few papers
may need a retry.

Free accounts are also limited to roughly 20 requests/minute and 50/day (1000/day once $10 of credit
has ever been bought), and the "free endpoints" data policy has to be enabled in OpenRouter's
privacy settings. For a real class set, `google/gemini-2.5-flash` is a few cents per batch, marks in
5–8 s, and is worth it.

Both providers go through the same prompts, schemas and normalisation in `lib/marking.ts` — the
provider only changes how the request is framed and how the answer is read back.

---

## Deploy to Vercel

```bash
npm i -g vercel
vercel
```

Then add the keys in the dashboard: **Project → Settings → Environment Variables** —
`AI_PROVIDER` plus `GEMINI_API_KEY` or `OPENROUTER_API_KEY` (Production, Preview and Development),
and redeploy. Switching provider on a live deployment is just changing `AI_PROVIDER` and
redeploying.

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
  api/analyze-guide/route   guide -> rubric (AI provider, JSON schema)
  api/mark/route            one student document -> marks (AI provider, JSON schema)
components/
  RubricReview.tsx          "here's what we'll mark" screen
  ResultsView.tsx           summary, per-student breakdown, report export
  Icons.tsx, Spinner.tsx    inline SVG icon set, iOS activity indicator
lib/
  report.ts                 the Word report: layout, styles, filename
  marking.ts                prompts, response schemas, normalisation
  ai/                       provider layer — swap with AI_PROVIDER
    index.ts                provider choice, retries, JSON parsing
    gemini.ts               generateContent dialect
    openrouter.ts           chat/completions dialect (PDF + image parts)
    schema.ts               Gemini schema -> plain JSON Schema
    types.ts                the provider contract
  client.ts                 image compression, base64, fetch wrapper, downloads
  validate.ts               request parsing and size guards
  types.ts, constants.ts    shared types and limits
```

## Limits

- 3 MB per file, 3 MB combined for the marking guide. This is the Vercel serverless request body
  cap (4.5 MB) minus base64 overhead.
- 25 student documents per batch, 2 marked concurrently to stay clear of Gemini rate limits.
- Files are sent to Gemini for marking and are not stored anywhere by this app.
