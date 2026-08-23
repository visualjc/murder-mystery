/**
 * A REAL in-process HTTP server that speaks the OpenAI-compatible
 * chat-completions protocol. This is the test double for the vendor — not a
 * mock: the client under test performs actual `fetch` calls over TCP against
 * it, so headers, status codes, JSON framing, retries and aborts are all
 * exercised for real.
 */

export interface RecordedRequest {
  /** HTTP method as the server saw it. */
  method: string;
  /** Path only, e.g. "/v1/chat/completions". */
  path: string;
  /** Raw Authorization header, so tests can assert the bearer scheme. */
  authorization: string | null;
  contentType: string | null;
  /** Parsed JSON body, or the raw string when the body is not JSON. */
  body: any;
  /** Milliseconds since the vendor started, for backoff assertions. */
  atMs: number;
}

/** Called for every request; `index` is 0 for the first call, 1 for the retry, ... */
export type VendorHandler = (
  request: RecordedRequest,
  index: number,
) => Response | Promise<Response>;

export interface FakeVendor {
  /** Base URL in the shape the client expects, e.g. http://localhost:1234/v1 */
  baseUrl: string;
  /** Every request the vendor received, in arrival order. */
  requests: RecordedRequest[];
  stop(): Promise<void>;
}

export function startFakeVendor(handler: VendorHandler): FakeVendor {
  const requests: RecordedRequest[] = [];
  const startedAt = Date.now();

  const server = Bun.serve({
    port: 0,
    // Long idle timeout so a deliberately slow handler is never cut short by
    // the server while we are measuring the CLIENT's timeout.
    idleTimeout: 30,
    async fetch(req) {
      const url = new URL(req.url);
      const raw = await req.text();
      let body: unknown = null;
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      const recorded: RecordedRequest = {
        method: req.method,
        path: url.pathname,
        authorization: req.headers.get("authorization"),
        contentType: req.headers.get("content-type"),
        body,
        atMs: Date.now() - startedAt,
      };
      const index = requests.length;
      requests.push(recorded);
      return await handler(recorded, index);
    },
  });

  return {
    baseUrl: `http://localhost:${server.port}/v1`,
    requests,
    async stop() {
      await server.stop(true);
    },
  };
}

/** A well-formed OpenAI-compatible success body. Omit `usage` to simulate a provider that does not report it. */
export function completionResponse(opts: {
  content: string;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
}): Response {
  const body: Record<string, unknown> = {
    id: "chatcmpl-fake",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: opts.model ?? "Fake-Model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: opts.content },
        finish_reason: "stop",
      },
    ],
  };
  if (opts.usage !== null && opts.usage !== undefined) body.usage = opts.usage;
  return Response.json(body);
}

/** An error body in the shape OpenAI-compatible providers return. */
export function errorResponse(status: number, message: string): Response {
  return Response.json({ error: { message, type: "fake_error", code: status } }, { status });
}

/** Reserve a port by starting and immediately stopping a server — nothing listens there afterwards. */
export async function deadBaseUrl(): Promise<string> {
  const vendor = startFakeVendor(() => new Response("never"));
  const url = vendor.baseUrl;
  await vendor.stop();
  return url;
}
