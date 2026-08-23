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
import { playerView } from '../../src/engine/view.ts';
import type { GameState } from '../../src/engine/types.ts';
import { CANNED_SCENARIO } from '../../src/gm/scenario.ts';
import { askSuspect, visibleFactsFor } from '../../src/gm/qa.ts';
import { completionResponse, errorResponse, startFakeVendor } from '../llm/fake-vendor.ts';
import { FIXTURE_CASE_FILE, FIXTURE_HANDS, arrangedGame, placeToken, standingInRoom } from '../engine/helpers.ts';
import { clientFor, promptTextOf } from './support.ts';

const QUESTION = 'Where were you when the lights went out?';

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

      // The whitelist, stated out loud: the suspect being asked, the players'
      // own tokens (public), and the two rooms those tokens stand in (public).
      const allowed = new Set<Card>([
        'Colonel Mustard',
        'Miss Scarlett',
        'Mrs. White',
        'Library',
        'Lounge',
      ]);
      const leaked = ([...SUSPECTS, ...WEAPONS, ...ROOMS] as Card[]).filter(
        (card) => body.includes(card) && !allowed.has(card),
      );
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

describe('visibleFactsFor', () => {
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
