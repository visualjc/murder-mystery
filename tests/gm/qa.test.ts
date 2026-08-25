/**
 * In-fiction Q&A: one free-form question to one suspect, per turn.
 *
 * The safety property is enforced by PROMPT CONSTRUCTION, not by trusting the
 * model to keep a secret (ADR-0001: "Prompts carry only what the receiving
 * player is entitled to know"). These tests therefore assert on the REQUEST
 * BODY the vendor actually received — the only place where a leak would be
 * visible before it reached a model.
 */

import { describe, expect, test } from 'bun:test';

import { ROOMS, SUSPECTS, WEAPONS, type Card } from '../../src/engine/cards.ts';
import { makeSuggestion } from '../../src/engine/actions.ts';
import { inRoom } from '../../src/engine/board.ts';
import { describeEvent, playerView } from '../../src/engine/view.ts';
import type { GameEvent, GameState } from '../../src/engine/types.ts';
import { CANNED_SCENARIO } from '../../src/gm/scenario.ts';
import { askSuspect, visibleFactsFor } from '../../src/gm/qa.ts';
import { GameMaster } from '../../src/gm/index.ts';
import { completionResponse, errorResponse, startFakeVendor } from '../llm/fake-vendor.ts';
import { FIXTURE_CASE_FILE, FIXTURE_HANDS, arrangedGame, placeToken, standingInRoom } from '../engine/helpers.ts';
import { clientFor, messageOfRole, promptTextOf } from './support.ts';

const QUESTION = 'Where were you when the lights went out?';

/**
 * The cards a prompt built from p1's view of `loadedGame` may legitimately
 * name: the suspect being asked, the players' own tokens (public), and the two
 * rooms those tokens stand in (public). Everything else is a leak.
 */
const WHITELIST: ReadonlySet<Card> = new Set<Card>([
  'Colonel Mustard',
  'Miss Scarlett',
  'Mrs. White',
  'Library',
  'Lounge',
]);

/** Every card of the 21 that `text` names outside the whitelist. */
function leakedCards(text: string, allowed: ReadonlySet<Card> = WHITELIST): Card[] {
  return ([...SUSPECTS, ...WEAPONS, ...ROOMS] as Card[]).filter(
    (card) => text.includes(card) && !allowed.has(card),
  );
}

/**
 * A game whose VISIBLE log is stuffed with the case file's own card names: p1
 * suggested exactly the solution and nobody could refute. An implementation
 * that dumped the event log, the hands, or the token positions into the prompt
 * would hand the model all three answers.
 */
function loadedGame(): GameState {
  let state = makeSuggestion(standingInRoom(arrangedGame(), 'p1', 'Study'), {
    suspect: 'Professor Plum',
    weapon: 'Wrench',
  });
  state = placeToken(state, 'p1', inRoom('Library'));
  state = placeToken(state, 'p2', inRoom('Lounge'));
  return state;
}

/**
 * A suggestion by p2 that p3 refutes. p1 — the asker in these tests — saw that
 * a refutation happened and is entitled to say so; the card, the suggested
 * triple and the room it was made in are not p1's to repeat.
 */
function refutedElsewhere(): GameState {
  return makeSuggestion(standingInRoom(arrangedGame(), 'p2', 'Kitchen'), {
    suspect: 'Reverend Green',
    weapon: 'Dagger',
  });
}

function eventOfType(state: GameState, type: GameEvent['type']): GameEvent {
  const event = state.events.find((candidate) => candidate.type === type);
  if (!event) throw new Error(`fixture has no ${type} event`);
  return event;
}

describe('the prompt carries only what the asker may know', () => {
  test('no case-file card name reaches the vendor', async () => {
    const state = loadedGame();
    const view = playerView(state, 'p1');
    // The raw view really does contain all three answers — that is the point.
    const rawLog = JSON.stringify(view.events);
    for (const card of [FIXTURE_CASE_FILE.suspect, FIXTURE_CASE_FILE.weapon, FIXTURE_CASE_FILE.room]) {
      expect(rawLog).toContain(card);
    }

    const vendor = startFakeVendor(() => completionResponse({ content: 'I was in the dark.' }));
    try {
      await askSuspect(clientFor(vendor.baseUrl), {
        scenario: CANNED_SCENARIO,
        view,
        suspect: 'Colonel Mustard',
        question: QUESTION,
      });
      const body = JSON.stringify(vendor.requests[0]!.body);
      console.log('[qa prompt] ->', promptTextOf(vendor.requests[0]!));

      expect(body).not.toContain(FIXTURE_CASE_FILE.suspect);
      expect(body).not.toContain(FIXTURE_CASE_FILE.weapon);
      expect(body).not.toContain(FIXTURE_CASE_FILE.room);
    } finally {
      await vendor.stop();
    }
  });

  test('only whitelisted cards appear at all — no hand, no log, no weapon board', async () => {
    const state = loadedGame();
    const view = playerView(state, 'p1');
    const vendor = startFakeVendor(() => completionResponse({ content: 'I was in the dark.' }));
    try {
      await askSuspect(clientFor(vendor.baseUrl), {
        scenario: CANNED_SCENARIO,
        view,
        suspect: 'Colonel Mustard',
        question: QUESTION,
      });
      const body = JSON.stringify(vendor.requests[0]!.body);

      const leaked = leakedCards(body);
      console.log('[qa whitelist] leaked ->', leaked);
      expect(leaked).toEqual([]);

      // Belt and braces: not one card of the asker's own hand beyond their token.
      for (const card of FIXTURE_HANDS.p1 as Card[]) {
        if (card === 'Miss Scarlett') continue;
        expect(body).not.toContain(card);
      }
    } finally {
      await vendor.stop();
    }
  });

  test('the asked suspect gets their own persona and nobody else’s', async () => {
    const view = playerView(loadedGame(), 'p1');
    const vendor = startFakeVendor(() => completionResponse({ content: 'Hmph.' }));
    try {
      await askSuspect(clientFor(vendor.baseUrl), {
        scenario: CANNED_SCENARIO,
        view,
        suspect: 'Colonel Mustard',
        question: QUESTION,
      });
      const prompt = promptTextOf(vendor.requests[0]!);

      expect(prompt).toContain(CANNED_SCENARIO.personas['Colonel Mustard']);
      expect(prompt).not.toContain(CANNED_SCENARIO.personas['Mrs. Peacock']);
      expect(prompt).not.toContain(CANNED_SCENARIO.personas['Professor Plum']);
      // The question reaches the model exactly as the player typed it.
      expect(prompt).toContain(QUESTION);
      expect(prompt).toContain(CANNED_SCENARIO.victim);
    } finally {
      await vendor.stop();
    }
  });
});

/**
 * A persona that cannot refer to anything that has happened is a persona with
 * nothing to say. The asker's OWN visible history is, by construction,
 * information the asker already holds — but only the part of it that names no
 * card a player CHOSE: a suggestion names three arbitrary cards and is the
 * single easiest way to walk the answer into a prompt.
 */
describe('the asker’s own history reaches the persona', () => {
  test('what the asker saw is quoted in the engine’s own words', async () => {
    const state = loadedGame();
    const vendor = startFakeVendor(() => completionResponse({ content: 'I remember it well.' }));
    try {
      await askSuspect(clientFor(vendor.baseUrl), {
        scenario: CANNED_SCENARIO,
        view: playerView(state, 'p1'),
        suspect: 'Colonel Mustard',
        question: QUESTION,
      });
      const prompt = promptTextOf(vendor.requests[0]!);
      console.log('[qa history] ->', prompt);

      expect(prompt).toContain(describeEvent(eventOfType(state, 'game-started')));
      expect(prompt).toContain(describeEvent(eventOfType(state, 'suggestion-unrefuted')));
      // ... but never the suggestion itself: it names all three answers.
      expect(prompt).not.toContain(describeEvent(eventOfType(state, 'suggestion-made')));
      expect(prompt).not.toContain(describeEvent(eventOfType(state, 'token-relocated')));
    } finally {
      await vendor.stop();
    }
  });

  test('a refutation between others is told as p1 saw it — without the card', async () => {
    const state = refutedElsewhere();
    const vendor = startFakeVendor(() => completionResponse({ content: 'I saw nothing.' }));
    try {
      await askSuspect(clientFor(vendor.baseUrl), {
        scenario: CANNED_SCENARIO,
        view: playerView(state, 'p1'),
        suspect: 'Mrs. White',
        question: QUESTION,
      });
      const body = JSON.stringify(vendor.requests[0]!.body);
      console.log('[qa history refuted] ->', promptTextOf(vendor.requests[0]!));

      expect(body).toContain(describeEvent(eventOfType(state, 'suggestion-refuted')));
      // The suggested triple stays out, room included.
      for (const card of ['Reverend Green', 'Dagger', 'Kitchen']) {
        expect(body).not.toContain(card);
      }
    } finally {
      await vendor.stop();
    }
  });
});

/**
 * The scenario is the one part of a Q&A prompt written by a model rather than
 * by the engine, so it is the one part an attacker (or a merely careless
 * provider) controls. A scenario that names cards everywhere is FICTION: it
 * flows into the persona and the setting, where it says nothing true about this
 * game. What must not happen is the facts section — the whitelist the leak
 * defense rests on — picking up any hidden state along the way.
 */
describe('a hostile LLM-written scenario cannot smuggle state into the facts', () => {
  const HOSTILE_SCENARIO = JSON.stringify({
    victim: 'Professor Plum, found in the Study beside the Wrench',
    setting: 'The Kitchen, the Ballroom and the Conservatory, and a Lead Pipe on every mantel.',
    intro: 'It was Professor Plum, in the Study, with the Wrench.',
    suspects: SUSPECTS.map((suspect) => ({
      name: suspect,
      persona: `${suspect} never leaves the Billiard Room without the Revolver.`,
    })),
  });

  test('the fiction flows through, the facts section gains nothing', async () => {
    const vendor = startFakeVendor((request) =>
      (request.body as { response_format?: unknown }).response_format === undefined
        ? completionResponse({ content: 'I have nothing to add.' })
        : completionResponse({ content: HOSTILE_SCENARIO }),
    );
    try {
      const master = new GameMaster(clientFor(vendor.baseUrl));
      const scenario = await master.openScenario();
      const answer = await master.ask(playerView(loadedGame(), 'p1'), 'Colonel Mustard', QUESTION);

      expect(scenario.source).toBe('llm');
      expect(answer.source).toBe('llm');

      const qa = vendor.requests[1]!;
      const system = messageOfRole(qa, 'system');
      const user = messageOfRole(qa, 'user');
      console.log('[qa hostile scenario] user ->', user);

      // The hostile fiction really did reach the model — this is not passing
      // because the scenario was quietly dropped.
      expect(system).toContain(scenario.personas['Colonel Mustard']);
      expect(system).toContain(scenario.setting);
      expect(system).toContain('Billiard Room');

      // The facts section is where game state would land. It gains nothing.
      expect(leakedCards(user)).toEqual([]);
      expect(user).not.toContain('Professor Plum');
      expect(user).not.toContain('Wrench');
      expect(user).not.toContain('Study');

      // Every card the system message names comes from the scenario strings and
      // from nowhere else: strip them and the rest is inside the whitelist.
      const withoutFiction = [scenario.victim, scenario.setting, scenario.personas['Colonel Mustard']]
        .reduce((text, fiction) => text.split(fiction).join(' '), system);
      console.log('[qa hostile scenario] system minus fiction ->', withoutFiction);
      expect(leakedCards(withoutFiction)).toEqual([]);
    } finally {
      await vendor.stop();
    }
  });
});

describe('visibleFactsFor', () => {
  test('carries the asker’s visible history, card-bearing events removed', () => {
    const state = refutedElsewhere();
    const facts = visibleFactsFor(playerView(state, 'p1'), 'Mrs. White');
    console.log('[qa history facts] ->', facts.recentHistory);

    expect(facts.recentHistory).toEqual([
      describeEvent(eventOfType(state, 'game-started')),
      describeEvent(eventOfType(state, 'turn-started')),
      describeEvent(eventOfType(state, 'suggestion-refuted')),
    ]);
  });

  test('a long game is clamped to the most recent 20 lines', () => {
    const state = refutedElsewhere();
    const rolled = eventOfType(state, 'game-started');
    // A real event object, repeated: a long log without playing 30 real turns.
    const view = playerView(state, 'p1');
    const facts = visibleFactsFor(
      { ...view, events: [...Array.from({ length: 30 }, () => rolled), ...view.events] },
      'Mrs. White',
    );

    expect(facts.recentHistory).toHaveLength(20);
    expect(facts.recentHistory.at(-1)).toBe(describeEvent(eventOfType(state, 'suggestion-refuted')));
  });

  test('reports positions and counts, never cards in hands', () => {
    const facts = visibleFactsFor(playerView(loadedGame(), 'p1'), 'Colonel Mustard');
    console.log('[qa facts] ->', facts);

    expect(facts.askedSuspect).toBe('Colonel Mustard');
    expect(facts.askedSuspectLocation).toBe('the Lounge');
    expect(facts.askerCharacter).toBe('Miss Scarlett');
    expect(facts.askerLocation).toBe('the Library');
    expect(facts.stillInTheRunning).toEqual(['Miss Scarlett', 'Colonel Mustard', 'Mrs. White']);
    expect(facts.suggestionsHeard).toBe(1);
    expect(facts.unrefutedSuggestionsHeard).toBe(1);
    expect(JSON.stringify(facts)).not.toContain('Wrench');
  });
});

describe('degradation', () => {
  test('a dead vendor still gives the player an answer in character', async () => {
    const vendor = startFakeVendor(() => errorResponse(500, 'the suspect is speechless'));
    try {
      const answer = await askSuspect(clientFor(vendor.baseUrl), {
        scenario: CANNED_SCENARIO,
        view: playerView(loadedGame(), 'p1'),
        suspect: 'Colonel Mustard',
        question: QUESTION,
      });
      console.log('[qa fallback] ->', answer);

      expect(answer.source).toBe('fallback');
      expect(answer.suspect).toBe('Colonel Mustard');
      expect(answer.text.length).toBeGreaterThan(0);
      expect(answer.text).toContain('Colonel Mustard');
    } finally {
      await vendor.stop();
    }
  });

  test('an empty reply is not an answer', async () => {
    const vendor = startFakeVendor(() => completionResponse({ content: '   ' }));
    try {
      const answer = await askSuspect(clientFor(vendor.baseUrl), {
        scenario: CANNED_SCENARIO,
        view: playerView(loadedGame(), 'p1'),
        suspect: 'Colonel Mustard',
        question: QUESTION,
      });
      expect(answer.source).toBe('fallback');
    } finally {
      await vendor.stop();
    }
  });
});
