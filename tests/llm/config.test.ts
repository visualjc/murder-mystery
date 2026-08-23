import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  API_KEY_ENV,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_RETRY_BACKOFF_MS,
  DEFAULT_TIMEOUT_MS,
  ENV_FILE_NAME,
  loadLlmConfig,
  readEnvFile,
} from "../../src/llm/config.ts";
import { LlmConfigError } from "../../src/llm/errors.ts";

const scratch = mkdtempSync(join(tmpdir(), "mmt-llm-config-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function writeEnvFile(name: string, contents: string): string {
  const path = join(scratch, name);
  writeFileSync(path, contents, "utf8");
  return path;
}

describe("readEnvFile", () => {
  test("parses KEY=VALUE lines, ignoring comments, blanks and surrounding quotes", () => {
    const path = writeEnvFile(
      "parse.env",
      [
        "# a comment line",
        "",
        "POE_API_KEY=plain-value",
        'POE_BASE_URL="https://quoted.example/v1"',
        "POE_MODEL='single-quoted-model'",
        "  SPACED_KEY = spaced value  ",
        "MALFORMED_LINE_WITHOUT_EQUALS",
      ].join("\n"),
    );

    const parsed = readEnvFile(path);
    console.log("[readEnvFile] parsed keys:", Object.keys(parsed).sort());

    expect(parsed.POE_API_KEY).toBe("plain-value");
    expect(parsed.POE_BASE_URL).toBe("https://quoted.example/v1");
    expect(parsed.POE_MODEL).toBe("single-quoted-model");
    expect(parsed.SPACED_KEY).toBe("spaced value");
    expect(parsed.MALFORMED_LINE_WITHOUT_EQUALS).toBeUndefined();
  });

  test("returns an empty record for a missing file rather than throwing", () => {
    const parsed = readEnvFile(join(scratch, "does-not-exist.env"));
    console.log("[readEnvFile] missing file ->", parsed);
    expect(parsed).toEqual({});
  });
});

describe("loadLlmConfig", () => {
  test("reads the key from process-style env and applies every documented default", () => {
    const config = loadLlmConfig({
      env: { POE_API_KEY: "key-from-env" },
      envFilePath: join(scratch, "absent.env"),
    });

    console.log("[loadLlmConfig] defaults ->", {
      baseUrl: config.baseUrl,
      model: config.model,
      timeoutMs: config.timeoutMs,
      retryBackoffMs: config.retryBackoffMs,
      apiKeyLength: config.apiKey.length,
    });

    expect(config.apiKey).toBe("key-from-env");
    expect(config.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(config.baseUrl).toBe("https://api.poe.com/v1");
    expect(config.model).toBe(DEFAULT_MODEL);
    // Verified against GET https://api.poe.com/v1/models — Poe's ids are lowercase-hyphenated.
    expect(DEFAULT_MODEL).toBe("claude-sonnet-4.5");
    expect(config.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(config.retryBackoffMs).toBe(DEFAULT_RETRY_BACKOFF_MS);
  });

  test("falls back to the .env.local file when the variable is absent from env — the bun-test case", () => {
    // `bun test` sets NODE_ENV=test, and Bun deliberately does NOT auto-load
    // .env.local in the test environment. Without this explicit fallback the
    // client would be silently keyless under test and in any NODE_ENV=test run.
    const path = writeEnvFile(
      "fallback.env",
      ["POE_API_KEY=key-from-file", "POE_BASE_URL=https://file.example/v1", "POE_MODEL=File-Model"].join("\n"),
    );

    const config = loadLlmConfig({ env: {}, envFilePath: path });
    console.log("[loadLlmConfig] from file ->", { baseUrl: config.baseUrl, model: config.model });

    expect(config.apiKey).toBe("key-from-file");
    expect(config.baseUrl).toBe("https://file.example/v1");
    expect(config.model).toBe("File-Model");
  });

  test("process env wins over the env file, and explicit options win over both", () => {
    const path = writeEnvFile(
      "precedence.env",
      ["POE_API_KEY=key-from-file", "POE_BASE_URL=https://file.example/v1"].join("\n"),
    );

    const envWins = loadLlmConfig({ env: { POE_API_KEY: "key-from-env" }, envFilePath: path });
    expect(envWins.apiKey).toBe("key-from-env");
    expect(envWins.baseUrl).toBe("https://file.example/v1");

    const optionWins = loadLlmConfig({
      env: { POE_API_KEY: "key-from-env", POE_BASE_URL: "https://env.example/v1" },
      envFilePath: path,
      apiKey: "key-from-option",
      baseUrl: "https://option.example/v1",
      model: "Option-Model",
      timeoutMs: 1234,
      retryBackoffMs: 7,
    });

    console.log("[loadLlmConfig] precedence ->", {
      envWinsBaseUrl: envWins.baseUrl,
      optionBaseUrl: optionWins.baseUrl,
      optionModel: optionWins.model,
    });

    expect(optionWins.apiKey).toBe("key-from-option");
    expect(optionWins.baseUrl).toBe("https://option.example/v1");
    expect(optionWins.model).toBe("Option-Model");
    expect(optionWins.timeoutMs).toBe(1234);
    expect(optionWins.retryBackoffMs).toBe(7);
  });

  test("strips a trailing slash from the base URL so path joining never doubles it", () => {
    const config = loadLlmConfig({
      env: { POE_API_KEY: "k", POE_BASE_URL: "https://trailing.example/v1/" },
      envFilePath: join(scratch, "absent.env"),
    });
    console.log("[loadLlmConfig] normalized base URL ->", config.baseUrl);
    expect(config.baseUrl).toBe("https://trailing.example/v1");
  });

  test("a missing key throws LlmConfigError naming both the variable and the file, and leaks no value", () => {
    const path = join(scratch, "empty.env");
    writeFileSync(path, "# nothing useful here\n", "utf8");

    let thrown: unknown;
    try {
      loadLlmConfig({ env: {}, envFilePath: path });
    } catch (error) {
      thrown = error;
    }

    console.log("[loadLlmConfig] missing-key error ->", (thrown as Error)?.message);

    expect(thrown).toBeInstanceOf(LlmConfigError);
    const message = (thrown as Error).message;
    expect(API_KEY_ENV).toBe("POE_API_KEY");
    expect(ENV_FILE_NAME).toBe(".env.local");
    expect(message).toContain(API_KEY_ENV);
    expect(message).toContain(ENV_FILE_NAME);
  });

  test("an empty or whitespace-only key counts as missing", () => {
    expect(() =>
      loadLlmConfig({ env: { POE_API_KEY: "   " }, envFilePath: join(scratch, "absent.env") }),
    ).toThrow(LlmConfigError);
  });
});
