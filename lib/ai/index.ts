import { GeminiProvider } from "@/lib/ai/gemini";
import { OpenRouterProvider } from "@/lib/ai/openrouter";
import {
  AIError,
  type JsonRequest,
  type Provider,
  type ProviderId,
  type ProviderRequest,
} from "@/lib/ai/types";

export { AIError };
export type { FilePart, ProviderId } from "@/lib/ai/types";

/**
 * `instanceof` is not enough on its own: a serverless bundle can end up with two
 * copies of this class, and then a perfectly good AIError falls through to the
 * route's generic 500. The name + status check catches that case.
 */
export function isAIError(error: unknown): error is AIError {
  if (error instanceof AIError) return true;
  return (
    error instanceof Error &&
    error.name === "AIError" &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

const DEFAULT_FALLBACK_MODEL = "openrouter/free";

/**
 * Which provider to use. `AI_PROVIDER` wins when set; otherwise we take
 * whichever key is present, so an existing Gemini-only deploy keeps working
 * after this file lands.
 */
export function activeProviderId(): ProviderId {
  const configured = process.env.AI_PROVIDER?.trim().toLowerCase();

  if (configured === "gemini" || configured === "openrouter") return configured;

  if (configured) {
    throw new AIError(
      `AI_PROVIDER is set to "${configured}", which this app does not know. Use "gemini" or "openrouter".`,
      500,
    );
  }

  if (process.env.GEMINI_API_KEY?.trim()) return "gemini";
  if (process.env.OPENROUTER_API_KEY?.trim()) return "openrouter";
  return "gemini";
}

function providerFor(model?: string): Provider {
  return activeProviderId() === "openrouter" ? new OpenRouterProvider(model) : new GeminiProvider();
}

export function activeProvider(): Provider {
  return providerFor();
}

/** The model id to show in the report footer, e.g. "google/gemini-2.5-flash". */
export function activeModel(): string {
  return activeProvider().model;
}

/**
 * The model tried when the primary fails outright. OpenRouter's free router is
 * the default because it costs nothing and still reads PDFs and photos, so a
 * paid model that is out of credit, rate-limited or delisted still marks the
 * paper. Override with OPENROUTER_FALLBACK_MODEL, or set it to "" to disable.
 */
function fallbackModel(primary: Provider): string | undefined {
  if (primary.id !== "openrouter") return undefined;

  const configured = process.env.OPENROUTER_FALLBACK_MODEL?.trim();
  const candidate = configured === undefined ? DEFAULT_FALLBACK_MODEL : configured;

  if (!candidate || candidate === primary.model) return undefined;
  return candidate;
}

/**
 * One JSON-mode call, with the resilience a batch of papers needs: a transient
 * failure gets one retry, a provider that refuses structured output gets one
 * attempt in plain JSON mode, and a provider that fails outright hands over to
 * the fallback model.
 */
export async function generateJson<T>(request: JsonRequest): Promise<T> {
  const primary = providerFor();
  const fallbackId = fallbackModel(primary);

  try {
    return await attempt<T>(primary, request);
  } catch (error) {
    if (!fallbackId || !(error instanceof AIError) || !worthFallback(error)) throw error;

    // A fresh instance, so a second failure reports the fallback's own message.
    return attempt<T>(providerFor(fallbackId), request);
  }
}

/**
 * Timeouts are excluded on purpose: a serverless function only has ~60s, so
 * there is nothing left to spend on a second model. Those are retried from the
 * results screen instead.
 */
function worthFallback(error: AIError): boolean {
  if (error.status === 504) return false;
  return (
    error.transient ||
    error.schemaRejected ||
    error.modelUnavailable ||
    [402, 403, 404].includes(error.status)
  );
}

async function attempt<T>(provider: Provider, request: JsonRequest): Promise<T> {
  const primary = provider.buildRequest(request);
  const plain = provider.buildPlainJsonRequest?.(request);

  try {
    return await callOnce<T>(provider, primary);
  } catch (error) {
    if (!(error instanceof AIError)) throw error;

    if (error.schemaRejected && plain) {
      return callOnce<T>(provider, plain);
    }

    if (error.transient) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return callOnce<T>(provider, primary);
    }

    throw error;
  }
}

/** Serverless functions cap out around 60s; a free model can need most of it. */
function requestTimeoutMs(): number {
  const configured = Number(process.env.AI_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 5_000 ? configured : 55_000;
}

/**
 * The abort can land while the body is still streaming, not just on the initial
 * connect — Node's DOMException is not an Error, so reading the body inside the
 * same guard is what keeps a slow model from escaping as a raw 500.
 */
async function send(provider: Provider, request: ProviderRequest): Promise<{ response: Response; body: string }> {
  try {
    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(requestTimeoutMs()),
    });

    return { response, body: await response.text() };
  } catch (error) {
    const name = (error as { name?: string })?.name ?? "";
    const timedOut = name === "TimeoutError" || name === "AbortError";

    throw new AIError(
      timedOut
        ? "Marking took too long to come back. Try again, or upload a smaller file."
        : `Could not reach ${provider.label}. Check the server's internet connection.`,
      504,
      {
        detail: `${name || "Error"}: ${(error as Error)?.message ?? String(error)}`,
        transient: !timedOut,
      },
    );
  }
}

async function callOnce<T>(provider: Provider, request: ProviderRequest): Promise<T> {
  const started = Date.now();
  const { response, body: raw } = await send(provider, request);

  if (!response.ok) {
    throw provider.errorFor(response.status, raw);
  }

  let payload: unknown;

  try {
    payload = JSON.parse(raw);
  } catch {
    // Free and self-hosted upstreams occasionally answer 200 with an empty or
    // truncated body. Treat it as a blip so the caller retries.
    throw new AIError(`${provider.label} sent back something that was not JSON. Please try again.`, 502, {
      detail: raw.slice(0, 300) || "empty response body",
      transient: true,
    });
  }

  const reply = provider.extract(payload);

  if (reply.blockReason) {
    throw new AIError(`${provider.label} declined to process this file. Try a clearer scan.`, 422);
  }

  if (!reply.text.trim()) {
    throw new AIError(
      reply.finishReason === "length" || reply.finishReason === "MAX_TOKENS"
        ? "The marking guide produced too much detail for one response. Try splitting it into fewer pages."
        : `${provider.label} sent back an empty response. Please try again.`,
      502,
      { detail: `finishReason=${reply.finishReason ?? "none"} elapsed=${Date.now() - started}ms` },
    );
  }

  try {
    return JSON.parse(stripCodeFence(reply.text)) as T;
  } catch {
    throw new AIError(`Could not read ${provider.label}'s response. Please try again.`, 502, {
      detail: reply.text.slice(0, 400),
    });
  }
}

/** Plain JSON mode often answers inside ```json fences; strip them before parsing. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match ? match[1] : trimmed;
}
