import { toJsonSchema } from "@/lib/ai/schema";
import {
  AIError,
  DEFAULT_MAX_OUTPUT_TOKENS,
  type JsonRequest,
  type Provider,
  type ProviderReply,
  type ProviderRequest,
} from "@/lib/ai/types";

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash";

export class OpenRouterProvider implements Provider {
  readonly id = "openrouter" as const;
  readonly label = "OpenRouter";
  readonly model: string;

  private readonly apiKey: string;

  constructor(model?: string) {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
      throw new AIError(
        "The server has no OpenRouter API key. Add OPENROUTER_API_KEY to your environment and restart, or set AI_PROVIDER=gemini.",
        500,
      );
    }

    this.apiKey = apiKey;
    // The fallback provider is the same class with a different slug.
    this.model = model?.trim() || process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;
  }

  buildRequest(request: JsonRequest): ProviderRequest {
    return this.request(request, {
      response_format: {
        type: "json_schema",
        json_schema: {
          name: request.schemaName ?? "response",
          strict: true,
          schema: toJsonSchema(request.schema),
        },
      },
    });
  }

  /**
   * Not every model on OpenRouter advertises structured outputs. Falling back to
   * json_object plus the schema in the prompt keeps those models usable.
   */
  buildPlainJsonRequest(request: JsonRequest): ProviderRequest {
    return this.request(
      {
        ...request,
        prompt: `${request.prompt}

Reply with one JSON object and nothing else — no prose, no code fences. It must match this JSON Schema exactly:
${JSON.stringify(toJsonSchema(request.schema))}`,
      },
      { response_format: { type: "json_object" } },
    );
  }

  extract(payload: unknown): ProviderReply {
    const json = payload as {
      choices?: Array<{
        message?: { content?: unknown };
        finish_reason?: string;
        native_finish_reason?: string;
      }>;
      error?: { message?: string };
    };

    if (json.error?.message) {
      throw new AIError(`OpenRouter returned an error: ${json.error.message}`, 502, {
        detail: json.error.message,
      });
    }

    const choice = json.choices?.[0];
    const content = choice?.message?.content;

    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((part) => (typeof part === "string" ? part : ((part as { text?: string })?.text ?? ""))).join("")
          : "";

    return {
      text,
      finishReason: choice?.native_finish_reason ?? choice?.finish_reason,
    };
  }

  errorFor(status: number, body: string): AIError {
    const detail = body.slice(0, 600);
    const lower = body.toLowerCase();

    // A retired or mistyped slug comes back as a 400, not a 404.
    if (
      (status === 400 || status === 404) &&
      /not a valid model id|model not found|no endpoints found|is not available/.test(lower)
    ) {
      return new AIError(
        `OpenRouter does not recognise the model "${this.model}". Check OPENROUTER_MODEL.`,
        status,
        { detail, modelUnavailable: true },
      );
    }

    // The upstream refused response_format. generateJson retries once in plain
    // JSON mode, so this only surfaces if that retry fails too.
    const refusedSchema =
      (status === 400 || status === 404 || status === 422) &&
      /response_format|json_schema|structured|no endpoints found/.test(lower);

    if (refusedSchema) {
      return new AIError(
        `${this.model} would not accept a structured JSON request through OpenRouter. Set OPENROUTER_MODEL to a model with structured outputs, such as google/gemini-2.5-flash or openai/gpt-4.1-mini.`,
        status,
        { detail, schemaRejected: true },
      );
    }

    if (status === 402) {
      // OpenRouter gates PDF parsing behind a credit floor; photos are not gated.
      return new AIError(
        /balance for files/i.test(body)
          ? "OpenRouter needs at least $0.50 of credit before it will accept PDFs. Top up at openrouter.ai/settings/credits, upload photos instead, or set AI_PROVIDER=gemini."
          : "OpenRouter says this account is out of credit. Top up at openrouter.ai/settings/credits, or switch AI_PROVIDER to gemini.",
        status,
        { detail },
      );
    }

    const message =
      status === 401 || status === 403
        ? "OpenRouter rejected the API key. Check that OPENROUTER_API_KEY is valid and still active."
        : status === 429
          ? "OpenRouter is rate-limiting requests right now. Give it a few seconds and retry."
          : status === 400
            ? "OpenRouter rejected the request. The file may be corrupt or unsupported."
            : status === 404
              ? `OpenRouter could not find the model "${this.model}". Check OPENROUTER_MODEL.`
              : "OpenRouter returned an error while marking.";

    return new AIError(message, status, { detail, transient: status === 429 || status >= 500 });
  }

  private request(request: JsonRequest, extra: Record<string, unknown>): ProviderRequest {
    const reasoning = resolveReasoning(this.model);

    return {
      url: API_URL,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        // OpenRouter uses these for app attribution on its activity page.
        "X-Title": process.env.OPENROUTER_APP_NAME?.trim() || "MarkGuide",
        ...(process.env.OPENROUTER_SITE_URL?.trim()
          ? { "HTTP-Referer": process.env.OPENROUTER_SITE_URL.trim() }
          : {}),
      },
      body: {
        model: this.model,
        messages: [
          { role: "system", content: request.system },
          {
            role: "user",
            content: [
              ...request.files.map((file, index) =>
                file.mimeType === "application/pdf"
                  ? {
                      type: "file",
                      file: {
                        filename: `page-${index + 1}.pdf`,
                        file_data: `data:application/pdf;base64,${file.data}`,
                      },
                    }
                  : {
                      type: "image_url",
                      image_url: { url: `data:${file.mimeType};base64,${file.data}` },
                    },
              ),
              { type: "text", text: request.prompt },
            ],
          },
        ],
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        ...(reasoning === undefined ? {} : { reasoning }),
        ...extra,
      },
    };
  }
}

/**
 * Marking is rubric matching, not a reasoning puzzle — the same reason Gemini's
 * thinking budget is zeroed for flash models. Free models are the slow ones and
 * a reasoning pass can take 30 of their 45 seconds, so `:free` slugs default to
 * no reasoning. Set OPENROUTER_REASONING to none|minimal|low|medium|high to
 * override either way.
 */
function resolveReasoning(model: string): Record<string, unknown> | undefined {
  const effort = process.env.OPENROUTER_REASONING?.trim().toLowerCase();

  if (effort) {
    if (effort === "none" || effort === "off" || effort === "false") return { enabled: false };
    if (effort === "minimal" || effort === "low" || effort === "medium" || effort === "high") {
      return { effort };
    }
  }

  return /:free$/.test(model) ? { enabled: false } : undefined;
}
