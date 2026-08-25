/**
 * The one boundary every model-supplied string crosses before the game treats
 * it as text — the scenario's fields, each narration line, and a suspect's
 * answer all become printable prose here and nowhere else.
 *
 * It exists for two reasons at once:
 *
 *  - a runaway model must not bloat the screen or every later prompt, so every
 *    string is collapsed to one line and clamped;
 *  - a model's text must not be able to DRIVE the terminal it is printed to
 *    (panel finding, codex), so every string is stripped of ANSI/OSC escapes
 *    first.
 *
 * Why here rather than at the HTTP layer: the scenario and the narration arrive
 * as JSON inside the reply, and JSON escapes control characters. A sanitizer at
 * the transport would see the six harmless characters of an escape sequence and
 * pass them through, and `JSON.parse` downstream would turn them back into the
 * real thing. This module sits AFTER that second decode, which is the first
 * point at which every model-sourced string exists in its final form.
 *
 * Engine text never passes through here. The engine's own sentences are trusted
 * by construction and are printed exactly as `describeEvent` wrote them.
 */

import { sanitizeVendorText } from '../llm/index.ts';

/** Strip the code fence models wrap JSON in, if there is one. */
export function unfence(text: string): string {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?\s*```\s*$/.exec(text);
  return fenced?.[1] ?? text;
}

/**
 * One model-supplied value as a printable line: control sequences removed,
 * whitespace collapsed, trimmed, and clamped to `limit` with an ellipsis.
 *
 * Returns null when the value is not a string or when nothing legible is left —
 * a reply that was nothing but escape sequences is no reply, and every caller
 * already has a fallback for that.
 *
 * Sanitizing comes first: removing a sequence can leave the spaces that
 * surrounded it adjacent, and the collapse then tidies them.
 */
export function tidyText(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null;
  const text = sanitizeVendorText(value).replace(/\s+/g, ' ').trim();
  if (text.length === 0) return null;
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
