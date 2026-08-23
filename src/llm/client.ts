import { loadLlmConfig, type LlmConfig, type LoadLlmConfigOptions } from "./config.ts";
import { sanitizeVendorText } from "./sanitize.ts";
import {
  LlmError,
  LlmHttpError,
  LlmNetworkError,
  LlmProtocolError,
  LlmTimeoutError,
} from "./errors.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** The token figures exactly as the provider reported them. Never estimated. */
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatResult {
  /** `choices[0].message.content`. */
  text: string;
  /** The response's `usage` object, or null when the provider did not report one. */
  usage: TokenUsage | null;
  /** The model the response attributed itself to, falling back to the model requested. */
  model: string;
}

export type ChatOutcome =
  | { ok: true; value: ChatResult }
  | { ok: false; error: LlmError };

export interface ChatOptions {
  /** Overrides the configured model for this call only. */
  model?: string;
  /** Overrides the configured timeout for this call only. */
  timeoutMs?: number;
  /** Extra protocol parameters merged into the request body (temperature, max_tokens, stop, ...). */
  params?: Record<string, unknown>;
  /** Caller-owned abort signal, honoured alongside the timeout. */
  signal?: AbortSignal;
}

export interface ModelUsage {
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * Running total for one client's lifetime — TOKEN-COUNT attribution v1
 * (orchestrator resolution 5rwbt08h): what is accounted for is token counts per
 * model, read from each response, not dollar cost.
 *
 * `byModel` is keyed by the LOWERCASED model id. Poe matches model ids
 * case-insensitively and echoes back whatever casing the request used, so
 * keying on the raw string would silently split one model's tokens across two
 * buckets and understate its share.
 */
export interface SessionUsage {
  /** COMPLETED responses. A failed call is not one, and never has been. */
  calls: number;
  /**
   * HTTP exchanges the client entered, retries included and failures included.
   *
   * Counted because a failed call is not a free call: the request left the
   * machine and the provider may well have spent tokens on it before answering
   * an error. A ledger that reported only completions told a session where
   * everything failed that nothing had happened (panel finding, agy).
   */
  attempts: number;
  /** Calls that ended in an `LlmError` — one per failed `chat`, not per retry. */
  failures: number;
  callsWithUsage: number;
  callsWithoutUsage: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  byModel: Record<string, ModelUsage>;
}

/** The attribution key for a model id: case- and whitespace-insensitive. */
export function usageKeyFor(model: string): string {
  return model.trim().toLowerCase();
}

const BODY_EXCERPT_LIMIT = 500;

/**
 * An OpenAI-compatible chat-completions client (ADR-0002).
 *
 * One transport, no vendor SDK: `POST {baseUrl}/chat/completions` with a bearer
 * key, a body of `{model, messages, ...params}`, and a reply read from
 * `choices[0].message.content` plus the response's own `usage` object.
 */
export class ChatClient {
  readonly config: LlmConfig;

  #calls = 0;
  #attempts = 0;
  #failures = 0;
  #callsWithUsage = 0;
  #promptTokens = 0;
  #completionTokens = 0;
  #totalTokens = 0;
  readonly #byModel = new Map<string, ModelUsage>();

  constructor(config: LlmConfig) {
    this.config = config;
  }

  /** The URL every request goes to. */
  get endpoint(): string {
    return `${this.config.baseUrl}/chat/completions`;
  }

  /** A defensive copy of the running token ledger. Mutating it cannot corrupt the client. */
  get usage(): SessionUsage {
    const byModel: Record<string, ModelUsage> = {};
    for (const [model, totals] of this.#byModel) byModel[model] = { ...totals };
    return {
      calls: this.#calls,
      attempts: this.#attempts,
      failures: this.#failures,
      callsWithUsage: this.#callsWithUsage,
      callsWithoutUsage: this.#calls - this.#callsWithUsage,
      prompt_tokens: this.#promptTokens,
      completion_tokens: this.#completionTokens,
      total_tokens: this.#totalTokens,
      byModel,
    };
  }

  /**
   * Perform one chat completion. Throws a typed `LlmError` on any failure —
   * use {@link tryChat} where a failure must degrade rather than propagate.
   */
  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const model = options.model ?? this.config.model;
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs;
    const body = JSON.stringify({ ...(options.params ?? {}), model, messages });

    try {
      const raw = await this.#send(body, timeoutMs, options.signal);
      const result = parseCompletion(raw, this.endpoint, model);
      this.#account(result);
      return result;
    } catch (error) {
      // One failure per failed CALL: the retries inside `#send` are already
      // counted as attempts. A caller-driven abort is not a vendor failure and
      // does not reach here as an `LlmError`.
      if (error instanceof LlmError) this.#failures += 1;
      throw error;
    }
  }

  /**
   * Perform one chat completion, returning a failure instead of throwing.
   *
   * PRODUCT.md hard constraint 5: the game stays playable when the model
   * errors, so the game loop calls this and falls back to plain engine text.
   */
  async tryChat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatOutcome> {
    try {
      return { ok: true, value: await this.chat(messages, options) };
    } catch (error) {
      if (error instanceof LlmError) return { ok: false, error };
      throw error;
    }
  }

  /**
   * One HTTP exchange, with a single retry on 429/5xx.
   *
   * A 4xx other than 429 is the caller's own bug and is never retried; a
   * timeout is not retried either, because the caller's deadline has already
   * passed once.
   */
  async #send(body: string, timeoutMs: number, callerSignal?: AbortSignal): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      const { response, raw } = await this.#attempt(body, timeoutMs, callerSignal);
      if (response.ok) return raw;

      const retryable = response.status === 429 || response.status >= 500;
      const excerpt = excerptOf(raw);

      if (retryable && attempt === 0) {
        await Bun.sleep(this.config.retryBackoffMs);
        continue;
      }

      throw new LlmHttpError({
        status: response.status,
        statusText: response.statusText,
        url: this.endpoint,
        bodyExcerpt: excerpt,
      });
    }
  }

  async #attempt(
    body: string,
    timeoutMs: number,
    callerSignal?: AbortSignal,
  ): Promise<{ response: Response; raw: string }> {
    // Counted before the request leaves: an exchange the vendor may have been
    // paid for is an exchange, however it ends.
    this.#attempts += 1;

    const controller = new AbortController();
    const onCallerAbort = () => controller.abort(callerSignal?.reason);
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body,
        signal: controller.signal,
      });
      // The body is read INSIDE the armed window: a vendor that sends headers
      // and then stalls the stream is a timeout, not a hang (panel critique,
      // drive kqrr2q4q). The same abort covers both halves of the exchange.
      const raw = await response.text();
      return { response, raw };
    } catch (cause) {
      if (timedOut) {
        throw new LlmTimeoutError({ baseUrl: this.config.baseUrl, timeoutMs });
      }
      if (callerSignal?.aborted) throw cause;
      throw new LlmNetworkError({ baseUrl: this.config.baseUrl, cause });
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  }

  #account(result: ChatResult): void {
    this.#calls += 1;
    if (result.usage === null) return;

    this.#callsWithUsage += 1;
    this.#promptTokens += result.usage.prompt_tokens;
    this.#completionTokens += result.usage.completion_tokens;
    this.#totalTokens += result.usage.total_tokens;

    const key = usageKeyFor(result.model);
    const totals = this.#byModel.get(key) ?? {
      calls: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    };
    totals.calls += 1;
    totals.prompt_tokens += result.usage.prompt_tokens;
    totals.completion_tokens += result.usage.completion_tokens;
    totals.total_tokens += result.usage.total_tokens;
    this.#byModel.set(key, totals);
  }
}

/** Build a client straight from the environment and `.env.local`. */
export function createChatClient(options: LoadLlmConfigOptions = {}): ChatClient {
  return new ChatClient(loadLlmConfig(options));
}

/** Read `choices[0].message.content` and the optional `usage` object out of a raw response body. */
export function parseCompletion(raw: string, url: string, requestedModel: string): ChatResult {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new LlmProtocolError({ url, reason: "response body is not JSON", bodyExcerpt: excerptOf(raw) });
  }

  if (typeof payload !== "object" || payload === null) {
    throw new LlmProtocolError({ url, reason: "response body is not an object", bodyExcerpt: excerptOf(raw) });
  }

  const record = payload as Record<string, unknown>;
  const choices = record.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new LlmProtocolError({ url, reason: "no choices in response", bodyExcerpt: excerptOf(raw) });
  }

  const message = (choices[0] as Record<string, unknown> | undefined)?.message as
    | Record<string, unknown>
    | undefined;
  const text = message?.content;
  if (typeof text !== "string") {
    throw new LlmProtocolError({
      url,
      reason: "choices[0].message.content is not a string",
      bodyExcerpt: excerptOf(raw),
    });
  }

  // The model id is the one vendor-supplied string that is NOT prose: it becomes
  // a ledger row printed at the end of the session, so it is stripped of
  // terminal control sequences here, where it enters (panel finding, codex) —
  // AND flattened to one line, because sanitize keeps LF/tab for prose and a
  // multi-line id would forge extra ledger rows (epic review round 2).
  // The reply text is not sanitized here on purpose — see src/gm/text.ts.
  const echoed = sanitizeVendorText(typeof record.model === "string" ? record.model : "")
    .replace(/\s+/g, " ")
    .trim();
  const model = echoed.length > 0 ? echoed : requestedModel;

  return { text, usage: parseUsage(record.usage), model };
}

/**
 * Read the provider's `usage` object.
 *
 * Absent or unusable usage yields null — tolerated, per ADR-0002, because not
 * every OpenAI-compatible host reports it. A partial object is NEVER
 * zero-filled (panel critique, drive kqrr2q4q — fabricated counts corrupt the
 * token ledger): the third field is derived exactly when two are present
 * (prompt + completion = total), and a lone field is no usage at all.
 */
export function parseUsage(value: unknown): TokenUsage | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;

  const prompt = numberOrNull(record.prompt_tokens);
  const completion = numberOrNull(record.completion_tokens);
  const total = numberOrNull(record.total_tokens);

  if (prompt !== null && completion !== null) {
    return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total ?? prompt + completion };
  }
  if (total !== null && prompt !== null) {
    return { prompt_tokens: prompt, completion_tokens: total - prompt, total_tokens: total };
  }
  if (total !== null && completion !== null) {
    return { prompt_tokens: total - completion, completion_tokens: completion, total_tokens: total };
  }
  return null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function excerptOf(body: string): string {
  const trimmed = body.trim();
  return trimmed.length > BODY_EXCERPT_LIMIT
    ? `${trimmed.slice(0, BODY_EXCERPT_LIMIT)}… (truncated)`
    : trimmed;
}
