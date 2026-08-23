/**
 * The scenario: the fiction wrapped around a mechanically standard game.
 *
 * One LLM call at setup produces a victim, an era and setting, an opening
 * paragraph, and a one-line persona per suspect. Everything after that is
 * fixed for the session (CONTEXT.md, "Scenario").
 *
 * PRODUCT.md hard constraint 4 and ADR-0001 govern the failure path: game
 * legality never depends on LLM output, so a transport error, a reply that is
 * not JSON, or JSON of the wrong shape all degrade to the canned scenario
 * below — field by field where possible — and the game is played exactly the
 * same way either way. The prompt carries no game state at all: the deck's card
 * names are public knowledge and the case file is not in scope here.
 */

import { ROOMS, SUSPECTS, WEAPONS, isSuspect, type Suspect } from '../engine/cards.ts';
import type { ChatClient, ChatMessage } from '../llm/index.ts';
import { LlmHttpError } from '../llm/index.ts';
import { tidyText, unfence } from './text.ts';

export type Scenario = {
  readonly victim: string;
  /** Era and place, in one phrase. */
  readonly setting: string;
  /** The opening paragraph read to the player once. */
  readonly intro: string;
  /** One line of voice per suspect — the only thing the Q&A layer role-plays from. */
  readonly personas: Readonly<Record<Suspect, string>>;
  readonly source: 'llm' | 'fallback';
};

/**
 * The scenario used whenever the model is unavailable or unusable.
 *
 * Deliberately card-free apart from the suspects' own names: this text is fed
 * into in-fiction Q&A prompts, and a canned line that named a room or a weapon
 * would put a card into a prompt for no reason.
 */
export const CANNED_SCENARIO: Scenario = {
  victim: 'Doctor Alastair Vane',
  setting: 'A great house cut off by a winter storm, a few years after the war.',
  intro:
    'The storm took the telephone lines at dusk, and the doctor was dead before the lamps were lit. ' +
    'Six guests remain under one roof, each with a reason to be elsewhere and none with a way to leave. ' +
    'Someone here is lying, and the truth is small enough to fit in three words.',
  personas: {
    'Miss Scarlett': 'Poised and quick, and answers an awkward question with a better one.',
    'Colonel Mustard': 'Bluff, military, fond of protocol, and offended that anyone would ask.',
    'Mrs. White': 'Keeps the household running and her opinions to herself. Misses nothing.',
    'Reverend Green': 'Soft-spoken and watchful, forever steering the talk toward forgiveness.',
    'Mrs. Peacock': 'Impeccably mannered, socially ruthless, certain the whole affair is beneath her.',
    'Professor Plum': 'Distracted and precise, far more interested in the puzzle than the tragedy.',
  },
  source: 'fallback',
};

const MAX_FIELD_LENGTH = 800;

/** The two messages the scenario call sends. Carries no game state. */
export function scenarioMessages(): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You dress a game of parlour-murder deduction in fiction. You invent atmosphere only: ' +
        'the mechanics of the game are fixed and are none of your concern. ' +
        'Reply with a single JSON object and nothing else — no prose, no code fences.',
    },
    {
      role: 'user',
      content: [
        'Invent a murder mystery for these six suspects:',
        SUSPECTS.map((suspect) => `- ${suspect}`).join('\n'),
        '',
        `The house has these rooms: ${ROOMS.join(', ')}.`,
        `These objects are in play: ${WEAPONS.join(', ')}.`,
        '',
        'Return exactly this JSON shape:',
        '{"victim": "<the murdered person\'s name>",',
        ' "setting": "<era and place, one phrase>",',
        ' "intro": "<one paragraph read aloud at the start, 3-5 sentences>",',
        ' "suspects": [{"name": "<one of the six names above, exactly>", "persona": "<one line of voice and motive>"}]',
        '}',
        '',
        'Do not name the murderer, the murder weapon, or the murder room: nobody knows them yet, including you.',
      ].join('\n'),
    },
  ];
}

/** One scenario field: sanitized, collapsed and clamped. Null when unusable. */
function tidy(value: unknown): string | null {
  return tidyText(value, MAX_FIELD_LENGTH);
}

/**
 * Read a scenario out of a model reply, filling each missing or unusable field
 * from the canned scenario. Returns null only when the reply is not a JSON
 * object at all — there is then nothing to salvage.
 */
export function parseScenario(text: string): Scenario | null {
  let payload: unknown;
  try {
    payload = JSON.parse(unfence(text));
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;

  const personas: Record<Suspect, string> = { ...CANNED_SCENARIO.personas };
  const entries = record.suspects;
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { name, persona } = entry as Record<string, unknown>;
      const line = tidy(persona);
      if (isSuspect(name) && line !== null) personas[name] = line;
    }
  }

  return {
    victim: tidy(record.victim) ?? CANNED_SCENARIO.victim,
    setting: tidy(record.setting) ?? CANNED_SCENARIO.setting,
    intro: tidy(record.intro) ?? CANNED_SCENARIO.intro,
    personas,
    source: 'llm',
  };
}

export type ScenarioOptions = {
  /** Model for this call only; defaults to the client's configured model. */
  readonly model?: string;
};

/**
 * Ask the model for one scenario, degrading to the canned one on any failure.
 *
 * `response_format: {type: "json_object"}` is requested because the endpoints
 * that honour it produce far cleaner replies. A provider that does not know the
 * parameter answers 4xx, so exactly one retry is made without it before giving
 * up — a 5xx is NOT retried here, the transport already retried it once.
 */
export async function requestScenario(
  client: ChatClient,
  options: ScenarioOptions = {},
): Promise<Scenario> {
  const messages = scenarioMessages();
  const model = options.model === undefined ? {} : { model: options.model };

  const first = await client.tryChat(messages, {
    ...model,
    params: { temperature: 0.9, response_format: { type: 'json_object' } },
  });

  let reply = first;
  if (!first.ok && first.error instanceof LlmHttpError && first.error.status < 500) {
    reply = await client.tryChat(messages, { ...model, params: { temperature: 0.9 } });
  }

  if (!reply.ok) return CANNED_SCENARIO;
  return parseScenario(reply.value.text) ?? CANNED_SCENARIO;
}
