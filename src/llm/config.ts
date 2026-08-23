import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { LlmConfigError } from "./errors.ts";

/** Poe's OpenAI-compatible base, per ADR-0002. Swapping providers is a config change, not a code change. */
export const DEFAULT_BASE_URL = "https://api.poe.com/v1";

/** The key's variable name, per PRODUCT.md hard constraint 2. */
export const API_KEY_ENV = "POE_API_KEY";

/** The gitignored file the key lives in. */
export const ENV_FILE_NAME = ".env.local";

/**
 * Default model, verified present in `GET https://api.poe.com/v1/models`
 * (2026-08-23). Poe's ids are lowercase-hyphenated and it matches them
 * case-insensitively. Overridable via POE_MODEL or per call.
 */
export const DEFAULT_MODEL = "claude-sonnet-4.5";

export const DEFAULT_TIMEOUT_MS = 60_000;

/** Delay before the single permitted retry on 429/5xx. */
export const DEFAULT_RETRY_BACKOFF_MS = 500;

export const BASE_URL_ENV = "POE_BASE_URL";
export const MODEL_ENV = "POE_MODEL";

/** Overrides which dotenv file is read. Empty or unset means the default below. */
export const ENV_FILE_ENV = "POE_ENV_FILE";

/**
 * The directory this package lives in: the nearest ancestor of this module that
 * holds a `package.json`. Falls back to the module's own directory if there is
 * none, which cannot happen in a checkout but must not throw if it does.
 */
function packageRoot(): string {
  let directory = import.meta.dir;
  for (;;) {
    if (existsSync(join(directory, "package.json"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return import.meta.dir;
    directory = parent;
  }
}

/**
 * The dotenv file read when nothing overrides it: the INSTALLATION's own
 * `.env.local`, not the current directory's.
 *
 * Resolving this against `process.cwd()` was a panel finding (codex): a game
 * launched from anywhere else silently read that directory's `.env.local`
 * instead — someone else's key, or a planted one whose POE_BASE_URL pointed the
 * whole session at an endpoint of the planter's choosing. The key belongs to
 * the install, so it is found from the install.
 */
export const DEFAULT_ENV_FILE_PATH = resolve(packageRoot(), ENV_FILE_NAME);

export interface LlmConfig {
  /** Base URL with no trailing slash; "/chat/completions" is appended to it. */
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly retryBackoffMs: number;
}

export interface LoadLlmConfigOptions {
  /** Environment record to read. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /**
   * Path to the dotenv file used as a fallback. Defaults to the `POE_ENV_FILE`
   * variable if set, otherwise {@link DEFAULT_ENV_FILE_PATH} — the package
   * root's `.env.local`, never the current directory's.
   */
  envFilePath?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  retryBackoffMs?: number;
}

/**
 * Parse a dotenv-style file into a record.
 *
 * This exists because Bun's automatic `.env.local` loading is NOT active when
 * `NODE_ENV=test` — which is exactly what `bun test` sets. Relying on the
 * runtime alone would leave the client silently keyless under test. A missing
 * file is not an error; it just yields no values.
 */
export function readEnvFile(path: string): Record<string, string> {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return {};
  }

  const values: Record<string, string> = {};
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    if (key.length === 0) continue;

    let value = line.slice(separator + 1).trim();
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }
    values[key] = value;
  }
  return values;
}

/**
 * Resolve the client's configuration.
 *
 * Precedence for every value: explicit option, then the environment, then the
 * dotenv file, then the built-in default. A missing key is fatal and names both
 * the variable and the file so the failure is self-explanatory. The key itself
 * is never written to a log, a message, or nahel state.
 */
export function loadLlmConfig(options: LoadLlmConfigOptions = {}): LlmConfig {
  const env = options.env ?? (process.env as Record<string, string | undefined>);
  const fromVariable = env[ENV_FILE_ENV];
  const envFilePath =
    options.envFilePath ??
    (isPresent(fromVariable) ? resolve(fromVariable.trim()) : DEFAULT_ENV_FILE_PATH);
  const fileEnv = readEnvFile(envFilePath);

  const pick = (name: string): string | undefined => {
    const fromEnv = env[name];
    if (isPresent(fromEnv)) return fromEnv.trim();
    const fromFile = fileEnv[name];
    if (isPresent(fromFile)) return fromFile.trim();
    return undefined;
  };

  const apiKey = isPresent(options.apiKey) ? options.apiKey.trim() : pick(API_KEY_ENV);
  if (apiKey === undefined) {
    throw new LlmConfigError(
      `Missing ${API_KEY_ENV}. Set it in the gitignored ${ENV_FILE_NAME} that was looked for at ` +
        `${envFilePath} (as ${API_KEY_ENV}=<your key>), point ${ENV_FILE_ENV} at another file, ` +
        `or export it in the environment. ` +
        `Note that Bun does not auto-load ${ENV_FILE_NAME} when NODE_ENV=test.`,
    );
  }

  const baseUrl = stripTrailingSlash(options.baseUrl ?? pick(BASE_URL_ENV) ?? DEFAULT_BASE_URL);
  const model = options.model ?? pick(MODEL_ENV) ?? DEFAULT_MODEL;

  return {
    baseUrl,
    apiKey,
    model,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retryBackoffMs: options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS,
  };
}

function isPresent(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
