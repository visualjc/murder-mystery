/**
 * In-fiction Q&A: the player asks one suspect one free-form question per turn,
 * and the suspect answers in character.
 *
 * The leak is prevented by CONSTRUCTION, not by instruction. `visibleFactsFor`
 * builds an explicit, enumerated bundle of facts and the prompt is assembled
 * from that bundle alone — the model is never handed the `GameState`, the
 * event log, any hand (including the asker's own), or the board's card
 * inventory. Telling a model "do not reveal the solution" while pasting the
 * solution into its context is not a safeguard; not pasting it is.
 *
 * What the bundle deliberately excludes, and why:
 *   - the case file — nobody may see it, ever (ADR-0001);
 *   - every hand, including the asker's — a suspect has no business knowing
 *     which cards anyone holds, and passing them would put six card names into
 *     a prompt for no gain;
 *   - the event log — suggestions name arbitrary cards, so the log is the
 *     single easiest way to leak the answer into a prompt;
 *   - weapon and non-player token positions — same reason, less obviously.
 *
 * What it includes is public and already on the player's screen: the turn
 * number, where the asked suspect and the asker stand, who is still in the
 * running, and how many suggestions have been heard (counts, never contents).
 */

import type { Suspect } from '../engine/cards.ts';
import { describePosition, type PlayerView } from '../engine/view.ts';
import type { ChatClient, ChatMessage } from '../llm/index.ts';
import type { Scenario } from './scenario.ts';

export type VisibleFacts = {
  readonly turnNumber: number;
  readonly askedSuspect: Suspect;
  /** Where that suspect's token stands, as a phrase. Public. */
  readonly askedSuspectLocation: string;
  readonly askerCharacter: Suspect;
  readonly askerLocation: string;
  /** The player-controlled tokens not yet barred from winning. Public. */
  readonly stillInTheRunning: readonly Suspect[];
  /** How many suggestions this seat has heard. A count — never the cards. */
  readonly suggestionsHeard: number;
  readonly unrefutedSuggestionsHeard: number;
};

export type SuspectAnswer = {
  readonly suspect: Suspect;
  readonly text: string;
  readonly source: 'llm' | 'fallback';
};

const MAX_ANSWER_LENGTH = 600;
const MAX_QUESTION_LENGTH = 400;

/** The whole fact set a suspect is told about. Nothing else reaches the prompt. */
export function visibleFactsFor(view: PlayerView, suspect: Suspect): VisibleFacts {
  const seats: Suspect[] = [
    ...(view.eliminated ? [] : [view.character]),
    ...view.opponents.filter((opponent) => !opponent.eliminated).map((opponent) => opponent.character),
  ];
  let suggestionsHeard = 0;
  let unrefutedSuggestionsHeard = 0;
  for (const event of view.events) {
    if (event.type === 'suggestion-made') suggestionsHeard += 1;
    if (event.type === 'suggestion-unrefuted') unrefutedSuggestionsHeard += 1;
  }

  return {
    turnNumber: view.turnNumber,
    askedSuspect: suspect,
    askedSuspectLocation: describePosition(view.suspectPositions[suspect]),
    askerCharacter: view.character,
    askerLocation: describePosition(view.position),
    stillInTheRunning: seats,
    suggestionsHeard,
    unrefutedSuggestionsHeard,
  };
}

function clamp(text: string, limit: number): string {
  const tidy = text.replace(/\s+/g, ' ').trim();
  return tidy.length > limit ? `${tidy.slice(0, limit)}…` : tidy;
}

export function questionMessages(
  scenario: Scenario,
  suspect: Suspect,
  question: string,
  facts: VisibleFacts,
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        `You are ${suspect}, a guest questioned about a death in the house.`,
        `Your character: ${scenario.personas[suspect]}`,
        `Setting: ${scenario.setting}`,
        `The dead: ${scenario.victim}`,
        '',
        'Answer in character, in one or two sentences, in the first person.',
        'You are being questioned, not confessing: evade, deflect, or bristle as your character would.',
        'You do not know who the murderer is, what was used, or where it happened — nobody does yet.',
        'Never invent a clue, a location, an object, or another guest\'s whereabouts.',
        'You know only the facts listed by the questioner. Say nothing beyond them.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        'Facts you both can see:',
        `- It is turn ${facts.turnNumber}.`,
        `- You are in ${facts.askedSuspectLocation}.`,
        `- ${facts.askerCharacter}, who is asking, is in ${facts.askerLocation}.`,
        `- Still under suspicion: ${facts.stillInTheRunning.join(', ')}.`,
        `- Accusations aired so far: ${facts.suggestionsHeard}, of which ${facts.unrefutedSuggestionsHeard} went unanswered.`,
        '',
        `${facts.askerCharacter} asks you: ${clamp(question, MAX_QUESTION_LENGTH)}`,
      ].join('\n'),
    },
  ];
}

/** What a suspect says when the model is unavailable. In character, and empty of information. */
export function fallbackAnswer(suspect: Suspect): SuspectAnswer {
  return {
    suspect,
    text: `${suspect} holds your eye for a moment, says nothing worth writing down, and turns away.`,
    source: 'fallback',
  };
}

export type QuestionRequest = {
  readonly scenario: Scenario;
  /** The ASKER's view. Only the whitelist in `visibleFactsFor` is used. */
  readonly view: PlayerView;
  readonly suspect: Suspect;
  readonly question: string;
  /** Model for this call only; defaults to the client's configured model. */
  readonly model?: string;
};

/** Put one question to one suspect. Never throws; an unusable reply is no answer. */
export async function askSuspect(
  client: ChatClient,
  request: QuestionRequest,
): Promise<SuspectAnswer> {
  const facts = visibleFactsFor(request.view, request.suspect);
  const reply = await client.tryChat(
    questionMessages(request.scenario, request.suspect, request.question, facts),
    {
      ...(request.model === undefined ? {} : { model: request.model }),
      params: { temperature: 0.9 },
    },
  );
  if (!reply.ok) return fallbackAnswer(request.suspect);

  const text = clamp(reply.value.text, MAX_ANSWER_LENGTH);
  if (text.length === 0) return fallbackAnswer(request.suspect);
  return { suspect: request.suspect, text, source: 'llm' };
}
