/**
 * The chat client: the project's only LLM transport (ADR-0002).
 *
 * Everything downstream — the game master, the CLI — talks to the model
 * through this module and nothing else.
 */
export {
  ChatClient,
  createChatClient,
  parseCompletion,
  parseUsage,
  type ChatMessage,
  type ChatOptions,
  type ChatOutcome,
  type ChatResult,
  type ModelUsage,
  type SessionUsage,
  type TokenUsage,
} from "./client.ts";

export {
  API_KEY_ENV,
  BASE_URL_ENV,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_RETRY_BACKOFF_MS,
  DEFAULT_TIMEOUT_MS,
  ENV_FILE_NAME,
  MODEL_ENV,
  loadLlmConfig,
  readEnvFile,
  type LlmConfig,
  type LoadLlmConfigOptions,
} from "./config.ts";

export {
  LlmConfigError,
  LlmError,
  LlmHttpError,
  LlmNetworkError,
  LlmProtocolError,
  LlmTimeoutError,
} from "./errors.ts";
