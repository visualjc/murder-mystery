/**
 * Typed failures from the LLM transport.
 *
 * Every one of these is a `LlmError`, so a caller that only wants to degrade
 * gracefully can catch the base class. Per PRODUCT.md hard constraint 5 the
 * game must remain playable when the model is unreachable, so these carry
 * enough detail to report a failure without being fatal.
 *
 * No error ever embeds the API key: messages are built from the URL, the
 * status, and the vendor's own response body.
 */
export abstract class LlmError extends Error {
  protected constructor(message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions);
    this.name = new.target.name;
  }
}

/** Configuration is unusable — most commonly, no API key was found. */
export class LlmConfigError extends LlmError {
  constructor(message: string) {
    super(message);
  }
}

/** The vendor answered with a non-2xx status. */
export class LlmHttpError extends LlmError {
  readonly status: number;
  readonly url: string;
  /** First slice of the response body, for diagnosis. Truncated, never parsed for control flow. */
  readonly bodyExcerpt: string;

  constructor(args: { status: number; statusText: string; url: string; bodyExcerpt: string }) {
    super(
      `LLM request to ${args.url} failed with HTTP ${args.status}${
        args.statusText ? ` ${args.statusText}` : ""
      }: ${args.bodyExcerpt || "<empty body>"}`,
    );
    this.status = args.status;
    this.url = args.url;
    this.bodyExcerpt = args.bodyExcerpt;
  }
}

/** The request never reached the vendor (DNS, refused connection, TLS, socket reset). */
export class LlmNetworkError extends LlmError {
  readonly baseUrl: string;

  constructor(args: { baseUrl: string; cause: unknown }) {
    super(
      `LLM request to ${args.baseUrl} failed before a response was received: ${describe(args.cause)}`,
      { cause: args.cause },
    );
    this.baseUrl = args.baseUrl;
  }
}

/** The request was aborted because it exceeded the configured timeout. */
export class LlmTimeoutError extends LlmError {
  readonly baseUrl: string;
  readonly timeoutMs: number;

  constructor(args: { baseUrl: string; timeoutMs: number }) {
    super(`LLM request to ${args.baseUrl} timed out after ${args.timeoutMs}ms`);
    this.baseUrl = args.baseUrl;
    this.timeoutMs = args.timeoutMs;
  }
}

/** A 2xx response that does not speak the OpenAI-compatible shape. */
export class LlmProtocolError extends LlmError {
  readonly url: string;
  readonly bodyExcerpt: string;

  constructor(args: { url: string; reason: string; bodyExcerpt: string }) {
    super(
      `LLM response from ${args.url} is not OpenAI-compatible (${args.reason}): ${
        args.bodyExcerpt || "<empty body>"
      }`,
    );
    this.url = args.url;
    this.bodyExcerpt = args.bodyExcerpt;
  }
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  return String(cause);
}
