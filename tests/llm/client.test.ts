import { describe, expect, test } from "bun:test";

import { ChatClient, parseUsage } from "../../src/llm/client.ts";
import {
  LlmHttpError,
  LlmNetworkError,
  LlmProtocolError,
  LlmTimeoutError,
} from "../../src/llm/errors.ts";
import { loadLlmConfig } from "../../src/llm/config.ts";
import {
  completionResponse,
  deadBaseUrl,
  errorResponse,
  startFakeVendor,
} from "./fake-vendor.ts";

const TEST_KEY = "test-key-do-not-log";

/** Build a client pointed at a fake vendor, with test-fast timings. */
function clientFor(
  baseUrl: string,
  overrides: { timeoutMs?: number; retryBackoffMs?: number; model?: string } = {},
): ChatClient {
  return new ChatClient(
    loadLlmConfig({
      env: {},
      envFilePath: "/nonexistent/.env.local",
      apiKey: TEST_KEY,
      baseUrl,
      model: overrides.model ?? "Test-Model",
      timeoutMs: overrides.timeoutMs ?? 5_000,
      retryBackoffMs: overrides.retryBackoffMs ?? 20,
    }),
  );
}

describe("ChatClient — happy path", () => {
  test("posts the OpenAI-compatible request and returns text plus the usage figures verbatim", async () => {
    const vendor = startFakeVendor(() =>
      completionResponse({
        content: "The body was found in the conservatory.",
        model: "Vendor-Reported-Model",
        usage: { prompt_tokens: 41, completion_tokens: 12, total_tokens: 53 },
      }),
    );

    try {
      const client = clientFor(vendor.baseUrl);
      const result = await client.chat(
        [
          { role: "system", content: "You are the game master." },
          { role: "user", content: "Describe the scene." },
        ],
        { params: { temperature: 0.4, max_tokens: 200 } },
      );

      const request = vendor.requests[0]!;
      console.log("[happy path] request ->", {
        method: request.method,
        path: request.path,
        authorization: request.authorization,
        contentType: request.contentType,
        body: request.body,
      });
      console.log("[happy path] result ->", result);

      // Wire shape, per ADR-0002.
      expect(vendor.requests).toHaveLength(1);
      expect(request.method).toBe("POST");
      expect(request.path).toBe("/v1/chat/completions");
      expect(request.authorization).toBe(`Bearer ${TEST_KEY}`);
      expect(request.contentType).toContain("application/json");
      expect(request.body.model).toBe("Test-Model");
      expect(request.body.messages).toEqual([
        { role: "system", content: "You are the game master." },
        { role: "user", content: "Describe the scene." },
      ]);
      expect(request.body.temperature).toBe(0.4);
      expect(request.body.max_tokens).toBe(200);

      // Reply shape.
      expect(result.text).toBe("The body was found in the conservatory.");
      expect(result.model).toBe("Vendor-Reported-Model");
      expect(result.usage).toEqual({
        prompt_tokens: 41,
        completion_tokens: 12,
        total_tokens: 53,
      });
    } finally {
      await vendor.stop();
    }
  });

  test("a per-call model override is what actually goes on the wire", async () => {
    const vendor = startFakeVendor(() => completionResponse({ content: "ok" }));
    try {
      const client = clientFor(vendor.baseUrl, { model: "Config-Model" });
      await client.chat([{ role: "user", content: "hi" }], { model: "Override-Model" });
      console.log("[model override] body.model ->", vendor.requests[0]!.body.model);
      expect(vendor.requests[0]!.body.model).toBe("Override-Model");
    } finally {
      await vendor.stop();
    }
  });
});

describe("ChatClient — token accounting", () => {
  test("a provider that omits usage is tolerated: usage is null and the call still returns text", async () => {
    const vendor = startFakeVendor(() =>
      completionResponse({ content: "No usage reported here.", usage: null }),
    );

    try {
      const client = clientFor(vendor.baseUrl);
      const result = await client.chat([{ role: "user", content: "hi" }]);
      console.log("[missing usage] result ->", result, "session ->", client.usage);

      expect(result.text).toBe("No usage reported here.");
      expect(result.usage).toBeNull();

      const session = client.usage;
      expect(session.calls).toBe(1);
      expect(session.callsWithUsage).toBe(0);
      expect(session.callsWithoutUsage).toBe(1);
      expect(session.total_tokens).toBe(0);
    } finally {
      await vendor.stop();
    }
  });

  test("a lone-field usage object is treated as no usage — never zero-filled (panel fix)", async () => {
    const vendor = startFakeVendor(() =>
      completionResponse({ content: "partial", usage: { total_tokens: 9 } }),
    );
    try {
      const client = clientFor(vendor.baseUrl);
      const result = await client.chat([{ role: "user", content: "hi" }]);
      console.log("[partial usage] ->", result.usage);
      expect(result.usage).toBeNull();
      expect(client.usage.callsWithUsage).toBe(0);
      expect(client.usage.callsWithoutUsage).toBe(1);
    } finally {
      await vendor.stop();
    }
  });

  test("session usage sums across calls and attributes per model — TOKEN-COUNT attribution v1", async () => {
    const vendor = startFakeVendor((_request, index) =>
      completionResponse({
        content: `reply ${index}`,
        model: index === 0 ? "Model-A" : "Model-B",
        usage: { prompt_tokens: 10 + index, completion_tokens: 5, total_tokens: 15 + index },
      }),
    );

    try {
      const client = clientFor(vendor.baseUrl);
      await client.chat([{ role: "user", content: "one" }]);
      await client.chat([{ role: "user", content: "two" }]);
      await client.chat([{ role: "user", content: "three" }]);

      const session = client.usage;
      console.log("[session usage] ->", JSON.stringify(session, null, 2));

      expect(session.calls).toBe(3);
      expect(session.callsWithUsage).toBe(3);
      expect(session.prompt_tokens).toBe(10 + 11 + 12);
      expect(session.completion_tokens).toBe(15);
      expect(session.total_tokens).toBe(15 + 16 + 17);

      expect(session.byModel["model-a"]).toEqual({
        calls: 1,
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      });
      expect(session.byModel["model-b"]).toEqual({
        calls: 2,
        prompt_tokens: 23,
        completion_tokens: 10,
        total_tokens: 33,
      });
    } finally {
      await vendor.stop();
    }
  });

  test("attribution is case-insensitive: one model reported in two casings is one bucket", async () => {
    // Poe matches model ids case-insensitively and echoes back whatever casing
    // the caller sent, so keying the ledger on the raw string would split one
    // model's tokens in two and understate its share.
    const vendor = startFakeVendor((_request, index) =>
      completionResponse({
        content: "x",
        model: index === 0 ? "Claude-Sonnet-4.5" : "claude-sonnet-4.5",
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      }),
    );

    try {
      const client = clientFor(vendor.baseUrl);
      await client.chat([{ role: "user", content: "one" }]);
      await client.chat([{ role: "user", content: "two" }]);

      const session = client.usage;
      console.log("[case-insensitive attribution] byModel ->", session.byModel);

      expect(Object.keys(session.byModel)).toEqual(["claude-sonnet-4.5"]);
      expect(session.byModel["claude-sonnet-4.5"]).toEqual({
        calls: 2,
        prompt_tokens: 200,
        completion_tokens: 20,
        total_tokens: 220,
      });
    } finally {
      await vendor.stop();
    }
  });

  test("the usage snapshot is a copy — mutating it cannot corrupt the client's ledger", async () => {
    const vendor = startFakeVendor(() =>
      completionResponse({
        content: "x",
        model: "Model-A",
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      }),
    );
    try {
      const client = clientFor(vendor.baseUrl);
      await client.chat([{ role: "user", content: "hi" }]);
      const snapshot = client.usage;
      snapshot.total_tokens = 99_999;
      snapshot.byModel["model-a"]!.total_tokens = 99_999;
      console.log("[snapshot isolation] after mutation, client sees ->", client.usage);
      expect(client.usage.total_tokens).toBe(7);
      expect(client.usage.byModel["model-a"]!.total_tokens).toBe(7);
    } finally {
      await vendor.stop();
    }
  });
});

describe("ChatClient — HTTP errors", () => {
  test("401 throws LlmHttpError carrying the status and a body excerpt, and is not retried", async () => {
    const vendor = startFakeVendor(() => errorResponse(401, "Invalid authentication credentials"));

    try {
      const client = clientFor(vendor.baseUrl);
      let thrown: unknown;
      try {
        await client.chat([{ role: "user", content: "hi" }]);
      } catch (error) {
        thrown = error;
      }

      console.log("[401] error ->", {
        name: (thrown as Error)?.name,
        message: (thrown as Error)?.message,
        status: (thrown as LlmHttpError)?.status,
        bodyExcerpt: (thrown as LlmHttpError)?.bodyExcerpt,
      });

      expect(thrown).toBeInstanceOf(LlmHttpError);
      const error = thrown as LlmHttpError;
      expect(error.status).toBe(401);
      expect(error.bodyExcerpt).toContain("Invalid authentication credentials");
      expect(error.message).toContain("401");
      expect(error.message).not.toContain(TEST_KEY);
      expect(error.bodyExcerpt).not.toContain(TEST_KEY);
      expect(vendor.requests).toHaveLength(1);
    } finally {
      await vendor.stop();
    }
  });

  test("404 throws LlmHttpError naming the URL that was called, and is not retried", async () => {
    const vendor = startFakeVendor(() => errorResponse(404, "model not found"));

    try {
      const client = clientFor(vendor.baseUrl);
      let thrown: unknown;
      try {
        await client.chat([{ role: "user", content: "hi" }]);
      } catch (error) {
        thrown = error;
      }

      console.log("[404] error ->", (thrown as Error)?.message);
      expect(thrown).toBeInstanceOf(LlmHttpError);
      expect((thrown as LlmHttpError).status).toBe(404);
      expect((thrown as LlmHttpError).url).toBe(`${vendor.baseUrl}/chat/completions`);
      expect(vendor.requests).toHaveLength(1);
    } finally {
      await vendor.stop();
    }
  });

  test("a 400 is never retried — client errors are the caller's bug, not a transient fault", async () => {
    const vendor = startFakeVendor(() => errorResponse(400, "bad request"));
    try {
      const client = clientFor(vendor.baseUrl);
      await expect(client.chat([{ role: "user", content: "hi" }])).rejects.toBeInstanceOf(LlmHttpError);
      console.log("[400] attempts ->", vendor.requests.length);
      expect(vendor.requests).toHaveLength(1);
    } finally {
      await vendor.stop();
    }
  });

  test("a malformed success body (no choices) throws LlmProtocolError with an excerpt", async () => {
    const vendor = startFakeVendor(() => Response.json({ id: "x", object: "chat.completion" }));
    try {
      const client = clientFor(vendor.baseUrl);
      let thrown: unknown;
      try {
        await client.chat([{ role: "user", content: "hi" }]);
      } catch (error) {
        thrown = error;
      }
      console.log("[malformed] error ->", (thrown as Error)?.message);
      expect(thrown).toBeInstanceOf(LlmProtocolError);
      expect((thrown as LlmProtocolError).bodyExcerpt).toContain("chat.completion");
    } finally {
      await vendor.stop();
    }
  });

  test("non-JSON success body throws LlmProtocolError rather than crashing the parser", async () => {
    const vendor = startFakeVendor(() => new Response("<html>gateway page</html>", { status: 200 }));
    try {
      const client = clientFor(vendor.baseUrl);
      await expect(client.chat([{ role: "user", content: "hi" }])).rejects.toBeInstanceOf(
        LlmProtocolError,
      );
    } finally {
      await vendor.stop();
    }
  });
});

describe("ChatClient — retry policy", () => {
  test("429 then success: exactly one retry, after a backoff, and the second reply is returned", async () => {
    const vendor = startFakeVendor((_request, index) => {
      if (index === 0) return errorResponse(429, "rate limited, slow down");
      return completionResponse({
        content: "second attempt succeeded",
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      });
    });

    try {
      const client = clientFor(vendor.baseUrl, { retryBackoffMs: 50 });
      const result = await client.chat([{ role: "user", content: "hi" }]);

      const gapMs = vendor.requests[1]!.atMs - vendor.requests[0]!.atMs;
      console.log("[429 retry] attempts ->", vendor.requests.length, "gap ms ->", gapMs, "text ->", result.text);

      expect(vendor.requests).toHaveLength(2);
      expect(result.text).toBe("second attempt succeeded");
      expect(result.usage).toEqual({ prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 });
      expect(gapMs).toBeGreaterThanOrEqual(40);
      // Only the successful attempt is accounted for.
      expect(client.usage.calls).toBe(1);
    } finally {
      await vendor.stop();
    }
  });

  test("500 then success: server errors are retried too", async () => {
    const vendor = startFakeVendor((_request, index) =>
      index === 0
        ? errorResponse(503, "upstream unavailable")
        : completionResponse({ content: "recovered" }),
    );
    try {
      const client = clientFor(vendor.baseUrl, { retryBackoffMs: 10 });
      const result = await client.chat([{ role: "user", content: "hi" }]);
      console.log("[503 retry] attempts ->", vendor.requests.length, "text ->", result.text);
      expect(vendor.requests).toHaveLength(2);
      expect(result.text).toBe("recovered");
    } finally {
      await vendor.stop();
    }
  });

  test("persistent 429 retries at most ONCE, then surfaces the error", async () => {
    const vendor = startFakeVendor(() => errorResponse(429, "still rate limited"));
    try {
      const client = clientFor(vendor.baseUrl, { retryBackoffMs: 10 });
      let thrown: unknown;
      try {
        await client.chat([{ role: "user", content: "hi" }]);
      } catch (error) {
        thrown = error;
      }
      console.log("[persistent 429] attempts ->", vendor.requests.length);
      expect(vendor.requests).toHaveLength(2);
      expect(thrown).toBeInstanceOf(LlmHttpError);
      expect((thrown as LlmHttpError).status).toBe(429);
    } finally {
      await vendor.stop();
    }
  });
});

describe("ChatClient — timeout and network failure", () => {
  test("a slow vendor is aborted at the configured timeout and throws LlmTimeoutError", async () => {
    const vendor = startFakeVendor(async () => {
      await Bun.sleep(2_000);
      return completionResponse({ content: "too late" });
    });

    try {
      const client = clientFor(vendor.baseUrl, { timeoutMs: 150 });
      const startedAt = Date.now();
      let thrown: unknown;
      try {
        await client.chat([{ role: "user", content: "hi" }]);
      } catch (error) {
        thrown = error;
      }
      const elapsed = Date.now() - startedAt;

      console.log("[timeout] elapsed ms ->", elapsed, "error ->", (thrown as Error)?.message);

      expect(thrown).toBeInstanceOf(LlmTimeoutError);
      expect((thrown as LlmTimeoutError).timeoutMs).toBe(150);
      expect(elapsed).toBeLessThan(1_500);
      expect((thrown as Error).message).toContain("150");
    } finally {
      await vendor.stop();
    }
  });

  test("a timeout is not retried — one attempt, then the abort surfaces", async () => {
    const vendor = startFakeVendor(async () => {
      await Bun.sleep(1_000);
      return completionResponse({ content: "too late" });
    });
    try {
      const client = clientFor(vendor.baseUrl, { timeoutMs: 100, retryBackoffMs: 5 });
      await expect(client.chat([{ role: "user", content: "hi" }])).rejects.toBeInstanceOf(
        LlmTimeoutError,
      );
      console.log("[timeout no-retry] attempts ->", vendor.requests.length);
      expect(vendor.requests).toHaveLength(1);
    } finally {
      await vendor.stop();
    }
  });

  test("a dead endpoint throws LlmNetworkError naming the base URL", async () => {
    const dead = await deadBaseUrl();
    const client = clientFor(dead, { timeoutMs: 2_000 });

    let thrown: unknown;
    try {
      await client.chat([{ role: "user", content: "hi" }]);
    } catch (error) {
      thrown = error;
    }

    console.log("[network] base ->", dead, "error ->", (thrown as Error)?.message);
    expect(thrown).toBeInstanceOf(LlmNetworkError);
    expect((thrown as LlmNetworkError).baseUrl).toBe(dead);
    expect((thrown as Error).message).toContain(dead);
    expect((thrown as LlmNetworkError).cause).toBeDefined();
  });
});

describe("ChatClient — tryChat, the degradable path for the game loop", () => {
  test("returns ok:true with the result on success", async () => {
    const vendor = startFakeVendor(() =>
      completionResponse({ content: "narration", usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }),
    );
    try {
      const client = clientFor(vendor.baseUrl);
      const outcome = await client.tryChat([{ role: "user", content: "hi" }]);
      console.log("[tryChat ok] ->", outcome);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.value.text).toBe("narration");
        expect(outcome.value.usage?.total_tokens).toBe(5);
      }
    } finally {
      await vendor.stop();
    }
  });

  test("returns ok:false with the typed error instead of throwing into the game loop", async () => {
    const vendor = startFakeVendor(() => errorResponse(500, "boom"));
    try {
      const client = clientFor(vendor.baseUrl, { retryBackoffMs: 5 });
      const outcome = await client.tryChat([{ role: "user", content: "hi" }]);
      console.log("[tryChat failure] ->", { ok: outcome.ok, error: outcome.ok ? null : outcome.error.message });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error).toBeInstanceOf(LlmHttpError);
        expect((outcome.error as LlmHttpError).status).toBe(500);
      }
    } finally {
      await vendor.stop();
    }
  });

  test("a network failure also degrades to ok:false rather than throwing", async () => {
    const dead = await deadBaseUrl();
    const client = clientFor(dead, { timeoutMs: 2_000 });
    const outcome = await client.tryChat([{ role: "user", content: "hi" }]);
    console.log("[tryChat network] ->", { ok: outcome.ok, error: outcome.ok ? null : outcome.error.name });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toBeInstanceOf(LlmNetworkError);
  });
});

describe("ChatClient — panel-accepted fixes (drive kqrr2q4q)", () => {
  // codex panel critique 1: the timer used to be cleared when headers
  // arrived, so a vendor that stalls mid-BODY hung the call forever (or let
  // a bare AbortError escape tryChat as an untyped error).
  test("a vendor that sends headers then stalls the body still times out as LlmTimeoutError", async () => {
    const vendor = startFakeVendor(() => {
      const stalled = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"choices":[{"message":{"content":"'));
          // never closes, never enqueues again — headers are out, body stalls
        },
      });
      return new Response(stalled, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    try {
      const client = clientFor(vendor.baseUrl, { timeoutMs: 150 });
      const started = Date.now();
      let thrown: unknown;
      try {
        await client.chat([{ role: "user", content: "stall" }]);
      } catch (error) {
        thrown = error;
      }
      const elapsed = Date.now() - started;
      console.log("[stalled body] elapsed ms ->", elapsed, "error ->", (thrown as Error)?.message);
      expect(thrown).toBeInstanceOf(LlmTimeoutError);
      expect(elapsed).toBeLessThan(5_000);
    } finally {
      await vendor.stop();
    }
  });

  // codex panel critique 2: partial usage used to be zero-filled, silently
  // corrupting the token ledger with fabricated counts.
  test("parseUsage refuses to fabricate: one lone field is null, two fields derive the third", () => {
    console.log("[usage strictness] lone total ->", parseUsage({ total_tokens: 100 }));
    expect(parseUsage({ total_tokens: 100 })).toBeNull();
    expect(parseUsage({ prompt_tokens: 30 })).toBeNull();
    expect(parseUsage({ prompt_tokens: 30, completion_tokens: 12 })).toEqual({
      prompt_tokens: 30,
      completion_tokens: 12,
      total_tokens: 42,
    });
    expect(parseUsage({ prompt_tokens: 30, total_tokens: 42 })).toEqual({
      prompt_tokens: 30,
      completion_tokens: 12,
      total_tokens: 42,
    });
    expect(parseUsage({ completion_tokens: 12, total_tokens: 42 })).toEqual({
      prompt_tokens: 30,
      completion_tokens: 12,
      total_tokens: 42,
    });
    expect(parseUsage({ prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 })).toEqual({
      prompt_tokens: 30,
      completion_tokens: 12,
      total_tokens: 42,
    });
  });
});

/**
 * ATTEMPT accounting (panel finding, agy — and the gap the builder journaled
 * against itself): a ledger that counts only completed responses reports
 * nothing at all for a session that spent tokens server-side and then failed.
 * `calls` keeps its meaning — completed responses — and `attempts`/`failures`
 * say what was tried and what came back an error.
 */
describe("ChatClient — attempt and failure accounting", () => {
  test("a session where every call fails reports zero calls, but the attempts and the failure", async () => {
    const vendor = startFakeVendor(() => errorResponse(500, "down"));
    try {
      const client = clientFor(vendor.baseUrl, { retryBackoffMs: 5 });
      let thrown: unknown;
      try {
        await client.chat([{ role: "user", content: "hi" }]);
      } catch (error) {
        thrown = error;
      }
      const session = client.usage;
      console.log("[all-failure ledger] ->", JSON.stringify(session));

      expect(thrown).toBeInstanceOf(LlmHttpError);
      expect(session.calls).toBe(0);
      // One chat call, one transport retry: two HTTP exchanges, one failure.
      expect(vendor.requests).toHaveLength(2);
      expect(session.attempts).toBe(2);
      expect(session.failures).toBe(1);
      expect(session.total_tokens).toBe(0);
    } finally {
      await vendor.stop();
    }
  });

  test("a retried call that succeeds counts two attempts, one call and no failure", async () => {
    const vendor = startFakeVendor((_request, index) =>
      index === 0
        ? errorResponse(429, "slow down")
        : completionResponse({
            content: "recovered",
            usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          }),
    );
    try {
      const client = clientFor(vendor.baseUrl, { retryBackoffMs: 5 });
      await client.chat([{ role: "user", content: "hi" }]);
      const session = client.usage;
      console.log("[retried-then-ok ledger] ->", JSON.stringify(session));

      expect(session.calls).toBe(1);
      expect(session.attempts).toBe(2);
      expect(session.failures).toBe(0);
    } finally {
      await vendor.stop();
    }
  });

  test("a failure after a completed call leaves the completed call standing", async () => {
    const vendor = startFakeVendor((_request, index) =>
      index === 0
        ? completionResponse({
            content: "first",
            usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 },
          })
        : errorResponse(503, "gone"),
    );
    try {
      const client = clientFor(vendor.baseUrl, { retryBackoffMs: 5 });
      await client.chat([{ role: "user", content: "one" }]);
      const outcome = await client.tryChat([{ role: "user", content: "two" }]);
      const session = client.usage;
      console.log("[mixed ledger] ->", JSON.stringify(session));

      expect(outcome.ok).toBe(false);
      expect(session.calls).toBe(1);
      expect(session.callsWithUsage).toBe(1);
      // 1 success + (1 failed exchange + its retry) = 3 exchanges, 1 failure.
      expect(session.attempts).toBe(3);
      expect(session.failures).toBe(1);
      expect(session.total_tokens).toBe(10);
    } finally {
      await vendor.stop();
    }
  });

  test("a transport failure with no HTTP reply is still one attempt and one failure", async () => {
    const client = clientFor(await deadBaseUrl(), { retryBackoffMs: 5 });
    const outcome = await client.tryChat([{ role: "user", content: "hi" }]);
    console.log("[dead endpoint ledger] ->", JSON.stringify(client.usage));

    expect(outcome.ok).toBe(false);
    expect(client.usage.attempts).toBe(1);
    expect(client.usage.failures).toBe(1);
    expect(client.usage.calls).toBe(0);
  });

  test("failures counted through tryChat match those counted through chat", async () => {
    const vendor = startFakeVendor(() => errorResponse(400, "bad request"));
    try {
      const client = clientFor(vendor.baseUrl, { retryBackoffMs: 5 });
      await client.tryChat([{ role: "user", content: "one" }]);
      await client.tryChat([{ role: "user", content: "two" }]);
      console.log("[tryChat failures] ->", JSON.stringify(client.usage));

      // 400 is never retried: one exchange each.
      expect(client.usage.attempts).toBe(2);
      expect(client.usage.failures).toBe(2);
    } finally {
      await vendor.stop();
    }
  });
});
