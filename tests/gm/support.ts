/**
 * Shared rigging for the game-master tests.
 *
 * The "vendor" is the real in-process HTTP server from `tests/llm/fake-vendor.ts`
 * — the game master performs actual `fetch` calls against it, so failures,
 * malformed bodies and token accounting are all exercised for real. Nothing in
 * these tests is a mock.
 */

import { ChatClient } from '../../src/llm/client.ts';
import { loadLlmConfig } from '../../src/llm/config.ts';
import type { RecordedRequest } from '../llm/fake-vendor.ts';

const TEST_KEY = 'test-key-do-not-log';

/** A client pointed at a fake vendor, with test-fast timings. */
export function clientFor(
  baseUrl: string,
  overrides: { model?: string; timeoutMs?: number; retryBackoffMs?: number } = {},
): ChatClient {
  return new ChatClient(
    loadLlmConfig({
      env: {},
      envFilePath: '/nonexistent/.env.local',
      apiKey: TEST_KEY,
      baseUrl,
      model: overrides.model ?? 'Test-Model',
      timeoutMs: overrides.timeoutMs ?? 5_000,
      retryBackoffMs: overrides.retryBackoffMs ?? 10,
    }),
  );
}

/** Every message body the game master sent, concatenated — what the model would read. */
export function promptTextOf(request: RecordedRequest): string {
  const messages = (request.body as { messages?: { content?: unknown }[] }).messages ?? [];
  return messages.map((message) => String(message.content ?? '')).join('\n');
}
