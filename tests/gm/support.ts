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

/** The messages the game master sent, as plain role/content pairs. */
export function messagesOf(request: RecordedRequest): { role: string; content: string }[] {
  const messages =
    (request.body as { messages?: { role?: unknown; content?: unknown }[] }).messages ?? [];
  return messages.map((message) => ({
    role: String(message.role ?? ''),
    content: String(message.content ?? ''),
  }));
}

/** Every message body the game master sent, concatenated — what the model would read. */
export function promptTextOf(request: RecordedRequest): string {
  return messagesOf(request)
    .map((message) => message.content)
    .join('\n');
}

/** The content of the first message with this role, or '' if there is none. */
export function messageOfRole(request: RecordedRequest, role: string): string {
  return messagesOf(request).find((message) => message.role === role)?.content ?? '';
}

/**
 * A narration reply in the shape the narrator asks for: each line labelled with
 * the number of the event it answers (see parseNarration, item nrntyese).
 * `undefined` leaves that line unanswered, so the engine's own sentence stands.
 */
export function narrationReply(...texts: readonly (string | number | undefined)[]): string {
  return JSON.stringify(
    texts.flatMap((text, index) => (text === undefined ? [] : [{ n: index + 1, text }])),
  );
}
