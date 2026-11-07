/**
 * The provider-neutral contract for the only thing this app asks of a model:
 * read some documents, answer with JSON that matches a schema.
 *
 * Gemini and OpenRouter speak different dialects, so nothing above this layer
 * talks to either of them directly — routes call generateJson() and a provider
 * translates. Swapping providers is one environment variable.
 */

export type ProviderId = "gemini" | "openrouter";

/** A document handed to the model: base64, no `data:` prefix. */
export interface FilePart {
  mimeType: string;
  data: string;
}

/** What callers ask for. Schemas are authored once, in Gemini's dialect. */
export interface JsonRequest {
  system: string;
  files: FilePart[];
  prompt: string;
  schema: Record<string, unknown>;
  /** Name given to the schema on providers that insist on one. */
  schemaName?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface ProviderReply {
  text: string;
  /** Set when the provider refused the input outright (safety block). */
  blockReason?: string;
  /** Set when the model stopped early, e.g. "length". */
  finishReason?: string;
}

export interface Provider {
  id: ProviderId;
  /** Used in copy: "Gemini is rate-limiting requests right now." */
  label: string;
  model: string;
  buildRequest(request: JsonRequest): ProviderRequest;
  /**
   * The same call without structured output. Retried once when an upstream
   * refuses `response_format` — plenty of models still do.
   */
  buildPlainJsonRequest?(request: JsonRequest): ProviderRequest;
  extract(payload: unknown): ProviderReply;
  /** Turns a non-2xx response into something a teacher can act on. */
  errorFor(status: number, body: string): AIError;
}

/** Roughly matches the JSON we ask for, so responses don't get truncated. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

export interface AIErrorOptions {
  detail?: string;
  /** A rate limit, 5xx or network blip — worth one retry. */
  transient?: boolean;
  /** The upstream refused structured output; retry in plain JSON mode. */
  schemaRejected?: boolean;
  /** The model slug does not exist (or was retired); try the fallback. */
  modelUnavailable?: boolean;
}

export class AIError extends Error {
  status: number;
  detail?: string;
  transient: boolean;
  schemaRejected: boolean;
  modelUnavailable: boolean;

  constructor(message: string, status = 502, options: AIErrorOptions = {}) {
    super(message);
    this.name = "AIError";
    this.status = status;
    this.detail = options.detail;
    this.transient = options.transient ?? false;
    this.schemaRejected = options.schemaRejected ?? false;
    this.modelUnavailable = options.modelUnavailable ?? false;
  }
}
