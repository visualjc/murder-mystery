/**
 * The narrator: engine events in, prose out.
 *
 * One batched call per turn — a call per event would be slow, expensive, and
 * would lose the thread of what just happened. The engine's own
 * `describeEvent` sentence for each event is what goes INTO the prompt, so the
 * model is rephrasing a fact rather than inventing one, and it is also what
 * comes back out on any failure: narration is discardable by construction
 * (CONTEXT.md "Narration", ADR-0001).
 *
 * Narration is always FOR someone, and the request says who. Whatever events
 * the caller hands over are run through the engine's own `isVisibleTo` before a
 * prompt is built, so a caller slicing a turn off the raw `state.events` cannot
 * put another player's private refutation card into a vendor request — the
 * defense does not depend on every call site remembering to filter first
 * (ADR-0001: prompts carry only what the receiving player is entitled to know).
 */

import type { GameEvent, PlayerId } from '../engine/types.ts';
import { describeEvent, isVisibleTo } from '../engine/view.ts';
import type { ChatClient, ChatMessage } from '../llm/index.ts';
import type { Scenario } from './scenario.ts';
import { tidyText, unfence } from './text.ts';

export type NarrationLine = {
  readonly event: GameEvent;
  readonly text: string;
  /**
   * Where the words came from.
   *
   * `engine` and `fallback` are both the engine's own sentence, and the
   * difference between them matters to the caller: `engine` is the deliberate
   * voice for a critical event in a perfectly healthy game, while `fallback`
   * means the model was asked and did not deliver. Conflating them makes every
   * suggestion look like a vendor outage.
   */
  readonly source: 'llm' | 'engine' | 'fallback';
};

const MAX_LINE_LENGTH = 400;

/**
 * The events whose engine sentence is ALWAYS printed, whatever the model says.
 *
 * ADR-0001 draws the line at legality: the model describes, it never decides.
 * That guarantee is worth nothing if the description is the player's only
 * account of what was decided — a narrator that omits a refutation, or invents
 * one, changes what the player believes the rules produced, and deduction is
 * the entire game. These are the moments a player reasons FROM: whether a
 * suggestion was answered, which card answered it, who accused, who is out, and
 * how it ended.
 *
 * Everything else — rolls, moves, secret passages, tokens sliding across the
 * board — is scenery, and the model's voice replaces the engine's freely.
 *
 * A critical event is not narrated AT ALL: it is never put in the prompt, and
 * the engine's sentence is the only line the player gets for it. Printing both
 * the engine's sentence and the model's retelling — the first shape of this
 * guarantee — said every deduction-bearing fact twice in a row, and leaned on
 * the two strings happening to differ. Withholding the event is the stronger
 * rule and the shorter transcript, and it makes the prompt cheaper besides.
 */
export const CRITICAL_EVENTS: ReadonlySet<GameEvent['type']> = new Set([
  // The suggested TRIPLE is deduction input: a narration that renames the
  // suspect, weapon, or room corrupts every notebook downstream (epic review
  // round 2, codex) — so the engine states it even when the model also does.
  'suggestion-made',
  'suggestion-refuted',
  'suggestion-unrefuted',
  'refutation-card-shown',
  'accusation-made',
  'player-eliminated',
  'game-over',
] satisfies GameEvent['type'][]);

/** The engine's own account of each event — the fallback, verbatim. */
export function fallbackNarration(events: readonly GameEvent[]): NarrationLine[] {
  return events.map((event) => ({ event, text: describeEvent(event), source: 'fallback' as const }));
}

/**
 * Who sits in which seat — public information, already on the player's screen
 * in `renderStatus`, so putting it in the prompt gives the model nothing it
 * could leak.
 *
 * Without it the model reads the engine's internal vocabulary aloud: seat ids
 * become "Player two" and a corridor's grid coordinates become "position
 * sixteen-seven". Those are the engine's bookkeeping, not the fiction.
 */
export type Roster = readonly { readonly id: PlayerId; readonly character: string }[];

export function narrationMessages(
  scenario: Scenario,
  events: readonly GameEvent[],
  roster: Roster = [],
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You are the narrator of a parlour-murder mystery. You are told what happened and you say it well.',
        'Rules you may not break:',
        '- Never add an event, a clue, or a deduction that is not in the list you are given.',
        '- Never say who the murderer is, or what the murder weapon or room was. You do not know.',
        '- Call people by their character name. Never write a seat id (p1, p2) or "Player one".',
        '- Never read out corridor coordinates. A corridor is "the corridor", "the passage", "the hall" — never "sixteen-seven".',
        '- Write in the past tense throughout.',
        '- One sentence per numbered line, in the same order.',
        `Reply with a JSON array of ${events.length} strings and nothing else.`,
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Setting: ${scenario.setting}`,
        `The victim: ${scenario.victim}`,
        ...(roster.length === 0
          ? []
          : ['', 'At the table:', ...roster.map((seat) => `- ${seat.id} is ${seat.character}`)]),
        '',
        'What just happened, in order:',
        ...events.map((event, index) => `${index + 1}. ${describeEvent(event)}`),
      ].join('\n'),
    },
  ];
}

/**
 * Read up to `count` narration strings from a model reply.
 *
 * Returns one slot per event: a string where the model supplied a usable one,
 * null where it did not. A reply that is not a JSON array yields all nulls, so
 * the batch falls back wholesale.
 */
export function parseNarration(text: string, count: number): (string | null)[] {
  const slots: (string | null)[] = Array.from({ length: count }, () => null);
  let payload: unknown;
  try {
    payload = JSON.parse(unfence(text));
  } catch {
    return slots;
  }
  if (!Array.isArray(payload)) return slots;

  for (let index = 0; index < count; index += 1) {
    slots[index] = tidyText(payload[index], MAX_LINE_LENGTH);
  }
  return slots;
}

export type NarrationRequest = {
  readonly scenario: Scenario;
  /** Who this narration is for. Events not addressed to them are dropped. */
  readonly viewer: PlayerId;
  /** Candidate events. Filtered to the viewer's before anything else happens. */
  readonly events: readonly GameEvent[];
  /** Model for this call only; defaults to the client's configured model. */
  readonly model?: string;
  /** Seat-to-character names, so the prose uses the fiction's vocabulary. */
  readonly roster?: Roster;
};

/**
 * Narrate a turn's events to one viewer, falling back to the engine's own
 * sentences per event. Events the viewer may not see are dropped, not muted:
 * they get no line, because there is nothing to tell them about.
 */
export async function narrateEvents(
  client: ChatClient,
  request: NarrationRequest,
): Promise<NarrationLine[]> {
  const events = request.events.filter((event) => isVisibleTo(event, request.viewer));
  if (events.length === 0) return [];

  // Critical events are answered here and never reach the vendor. Only the
  // scenery is narrated, so the prompt is smaller and no deduction-bearing
  // sentence is ever handed to a model to rephrase.
  const scenery = events.filter((event) => !CRITICAL_EVENTS.has(event.type));
  const engineVoiced = (event: GameEvent): NarrationLine => ({
    event,
    text: describeEvent(event),
    source: 'engine' as const,
  });
  if (scenery.length === 0) return events.map(engineVoiced);

  const reply = await client.tryChat(
    narrationMessages(request.scenario, scenery, request.roster ?? []),
    {
      ...(request.model === undefined ? {} : { model: request.model }),
      params: { temperature: 0.8 },
    },
  );
  if (!reply.ok) {
    // The vendor failed. Scenery falls back; the critical events were never
    // its business, so they stay `engine` and the caller's outage notice is
    // still driven by a genuine failure alone.
    return events.map((event) =>
      CRITICAL_EVENTS.has(event.type)
        ? engineVoiced(event)
        : { event, text: describeEvent(event), source: 'fallback' as const },
    );
  }

  const slots = parseNarration(reply.value.text, scenery.length);
  let sceneryIndex = 0;
  return events.map((event) => {
    if (CRITICAL_EVENTS.has(event.type)) return engineVoiced(event);
    const line = slots[sceneryIndex];
    sceneryIndex += 1;
    return line === null || line === undefined
      ? { event, text: describeEvent(event), source: 'fallback' as const }
      : { event, text: line, source: 'llm' as const };
  });
}
