import {
  AIError,
  DEFAULT_MAX_OUTPUT_TOKENS,
  type JsonRequest,
  type Provider,
  type ProviderReply,
  type ProviderRequest,
} from "@/lib/ai/types";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiProvider implements Provider {
  readonly id = "gemini" as const;
  readonly label = "Gemini";
  readonly model: string;

  private readonly apiKey: string;
  private readonly thinkingBudget?: number;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      throw new AIError(
        "The server has no Gemini API key. Add GEMINI_API_KEY to your environment and restart, or set AI_PROVIDER=openrouter.",
        500,
      );
    }

    this.apiKey = apiKey;
    this.model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
    this.thinkingBudget = resolveThinkingBudget(this.model);
  }

  buildRequest({ system, files, prompt, schema, temperature = 0.2, maxOutputTokens }: JsonRequest): ProviderRequest {
    return {
      url: `${API_BASE}/${this.model}:generateContent`,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.apiKey,
      },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: [
          {
            role: "user",
            parts: [
              ...files.map((file) => ({
                inlineData: { mimeType: file.mimeType, data: file.data },
              })),
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          temperature,
          maxOutputTokens: maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          responseMimeType: "application/json",
          responseSchema: schema,
          ...(this.thinkingBudget === undefined
            ? {}
            : { thinkingConfig: { thinkingBudget: this.thinkingBudget } }),
        },
      },
    };
  }

  extract(payload: unknown): ProviderReply {
    const json = payload as {
      candidates?: Array<{
        finishReason?: string;
        content?: { parts?: Array<{ text?: string }> };
      }>;
      promptFeedback?: { blockReason?: string };
    };

    const candidate = json.candidates?.[0];

    return {
      text: candidate?.content?.parts?.map((part) => part.text ?? "").join("") ?? "",
      blockReason: json.promptFeedback?.blockReason,
      finishReason: candidate?.finishReason,
    };
  }

  errorFor(status: number, body: string): AIError {
    const detail = body.slice(0, 600);
    const transient = status === 429 || status >= 500;

    const message =
      status === 429
        ? "Gemini is rate-limiting requests right now. Give it a few seconds and retry."
        : status === 400
          ? "Gemini rejected the request. The file may be corrupt or unsupported."
          : status === 403 || status === 401
            ? "The Gemini API key was rejected. Check that it is valid and that the Generative Language API is enabled."
            : "Gemini returned an error while marking.";

    return new AIError(message, status, { detail, transient });
  }
}

/**
 * Marking is rubric matching, not a reasoning puzzle, so we skip the thinking
 * pass to keep a class set responsive on a phone. Gemini 2.5 Pro cannot disable
 * thinking, so it only gets a budget when one is configured explicitly.
 */
function resolveThinkingBudget(model: string): number | undefined {
  const configured = process.env.GEMINI_THINKING_BUDGET?.trim();
  if (configured !== undefined && configured !== "" && !Number.isNaN(Number(configured))) {
    return Number(configured);
  }
  return /flash/i.test(model) ? 0 : undefined;
}
