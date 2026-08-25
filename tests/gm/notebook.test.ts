/**
 * The deduction notebook, tested through REAL games only.
 *
 * Every event these tests reason about is produced by the real engine actions
 * (`makeSuggestion`, `provideRefutationCard`) over a real `createGame` state
 * whose hands are pinned by `tests/engine/helpers.ts`. Nothing is stubbed: the
 * notebook only ever sees what `playerView` would hand a seat in a live game.
 *
 * The centre of gravity here is the CORRECTED refutation rule (engine finding,
 * run e6g6g38j): a refuter shows a card THEY hold, so a named card already
 * proven to sit in ANOTHER player's hand is excluded from what they could have
 * shown, while a named card already proven to be the REFUTER'S OWN stays a
 * candidate. The naive "two located, so the refuter holds the third" form
 * derives false card locations; the test below pins the exact shape that breaks
 * it, and cross-checks the conclusion against the dealt truth.
 */

import { describe, expect, test } from 'bun:test';

import { makeSuggestion } from '../../src/engine/actions.ts';
import { playerView } from '../../src/engine/view.ts';
import type { GameState } from '../../src/engine/types.ts';
import { buildNotebook } from '../../src/gm/notebook.ts';
import {
  FIXTURE_CASE_FILE,
  FIXTURE_HANDS,
  arrangedGame,
  standingInRoom,
} from '../engine/helpers.ts';

/** p1 stands in `room` and names `suspect`/`weapon` — a real, legal suggestion. */
function suggestFrom(
  state: GameState,
  player: string,
  room: Parameters<typeof standingInRoom>[2],
  suspect: Parameters<typeof makeSuggestion>[1]['suspect'],
  weapon: Parameters<typeof makeSuggestion>[1]['weapon'],
): GameState {
  return makeSuggestion(standingInRoom(state, player, room), { suspect, weapon });
}

function notebookFor(state: GameState, player: string) {
  return buildNotebook(playerView(state, player));
}

describe('what a seat proves from its own hand', () => {
  test('every card in hand is proven held, and no card in hand is a candidate', () => {
    const notebook = notebookFor(arrangedGame(), 'p1');
    console.log('[own hand] held ->', [...notebook.held.entries()]);

    for (const card of FIXTURE_HANDS.p1 as string[]) {
      expect(notebook.held.get(card as never)).toBe('p1');
    }
    expect(notebook.suspects).not.toContain('Miss Scarlett');
    expect(notebook.weapons).not.toContain('Candlestick');
    expect(notebook.rooms).not.toContain('Kitchen');

    // Nothing else is proven yet, so every other card is still open.
    expect(notebook.suspects).toContain('Professor Plum');
    expect(notebook.weapons).toContain('Wrench');
    expect(notebook.rooms).toContain('Study');
    expect(notebook.solution).toBeNull();
  });
});

describe('a card shown to me is proven', () => {
  test('the refuter is recorded as the holder of the card they showed', () => {
    // p1 names two of its own cards plus Mrs. White; p2 holds nothing named, so
    // p3 must show Mrs. White, privately, to p1.
    const state = suggestFrom(arrangedGame(), 'p1', 'Kitchen', 'Mrs. White', 'Candlestick');
    const notebook = notebookFor(state, 'p1');
    console.log('[shown card] held ->', [...notebook.held.entries()]);

    expect(notebook.held.get('Mrs. White')).toBe('p3');
    expect(notebook.suspects).not.toContain('Mrs. White');
  });
});

describe('the corrected refutation rule', () => {
  test("a card known to be in the REFUTER'S OWN hand stays a candidate — no false location is derived", () => {
    // Step 1: p1 learns Mrs. White is p3's (p3 shows it).
    let state = suggestFrom(arrangedGame(), 'p1', 'Kitchen', 'Mrs. White', 'Candlestick');
    // Step 2: p1 learns the Dagger is p2's (p2 refutes first, clockwise).
    state = suggestFrom(state, 'p1', 'Kitchen', 'Miss Scarlett', 'Dagger');

    const before = notebookFor(state, 'p1');
    expect(before.held.get('Mrs. White')).toBe('p3');
    expect(before.held.get('Dagger')).toBe('p2');

    // Step 3: p2 suggests Mrs. White with the Dagger in the Library. p3 refutes
    // — p1 sees only THAT p3 refuted. Of the three named cards p1 already
    // places the Dagger in p2's hand (excluded: p3 cannot have shown it) and
    // Mrs. White in p3's own hand (NOT excluded: it is exactly what p3 could
    // have shown). So two candidates remain and nothing may be concluded.
    state = suggestFrom(state, 'p2', 'Library', 'Mrs. White', 'Dagger');

    const notebook = notebookFor(state, 'p1');
    console.log('[corrected rule] held ->', [...notebook.held.entries()]);
    console.log('[corrected rule] room candidates ->', notebook.rooms);

    // The naive rule ("two of three located, so the refuter holds the third")
    // would write Library -> p3 here. That is FALSE: p2 holds the Library.
    expect(notebook.held.get('Library')).toBeUndefined();
    expect(notebook.rooms).toContain('Library');

    // Cross-check every belief against the dealt truth: nothing false at all.
    const truth = new Map<string, string>();
    for (const [owner, hand] of Object.entries(FIXTURE_HANDS)) {
      for (const card of hand) truth.set(card, owner);
    }
    for (const [card, holder] of notebook.held) {
      expect(`${card}:${holder}`).toBe(`${card}:${truth.get(card) ?? 'case-file'}`);
    }
  });

  test("a card known to be in ANOTHER player's hand IS excluded, so a lone survivor is proven", () => {
    // Step 1: p1 learns Colonel Mustard is p2's.
    let state = suggestFrom(arrangedGame(), 'p1', 'Kitchen', 'Colonel Mustard', 'Candlestick');
    // Step 2: p1 learns the Library is p2's (suggesting from inside it).
    state = suggestFrom(state, 'p1', 'Library', 'Miss Scarlett', 'Candlestick');

    const before = notebookFor(state, 'p1');
    expect(before.held.get('Colonel Mustard')).toBe('p2');
    expect(before.held.get('Library')).toBe('p2');
    expect(before.held.get('Rope')).toBeUndefined();

    // Step 3: p2 suggests Colonel Mustard with the Rope in the Library; p3
    // refutes. Mustard and the Library are both p2's — the SUGGESTER's, not the
    // refuter's — so neither could have been shown. Only the Rope survives.
    state = suggestFrom(state, 'p2', 'Library', 'Colonel Mustard', 'Rope');

    const notebook = notebookFor(state, 'p1');
    console.log('[exclusion] held ->', [...notebook.held.entries()]);

    expect(notebook.held.get('Rope')).toBe('p3');
    expect(FIXTURE_HANDS.p3).toContain('Rope'); // the conclusion is true
    expect(notebook.weapons).not.toContain('Rope');
  });
});

describe('an unrefuted suggestion of my own', () => {
  test('every named card not in my hand is proven to be in the case file', () => {
    // The case file is Professor Plum / Wrench / Study, and p1 holds none of
    // them. Nobody can refute, so all three are the answer.
    const state = suggestFrom(arrangedGame(), 'p1', 'Study', 'Professor Plum', 'Wrench');
    const notebook = notebookFor(state, 'p1');
    console.log('[unrefuted] case-file cards ->', [...notebook.caseFileCards]);
    console.log('[unrefuted] solution ->', notebook.solution);

    expect([...notebook.caseFileCards].sort()).toEqual(['Professor Plum', 'Study', 'Wrench']);
    expect(notebook.suspects).toEqual(['Professor Plum']);
    expect(notebook.weapons).toEqual(['Wrench']);
    expect(notebook.rooms).toEqual(['Study']);
    expect(notebook.solution).toEqual(FIXTURE_CASE_FILE);
  });

  test("another player's unrefuted suggestion proves nothing to me — they may hold the cards", () => {
    // p2 suggests from the Library. p2 holds the Library itself, so nobody
    // refutes — but that tells p1 nothing about the case file.
    const state = suggestFrom(arrangedGame(), 'p2', 'Library', 'Professor Plum', 'Wrench');
    const notebook = notebookFor(state, 'p1');
    console.log('[other unrefuted] case-file cards ->', [...notebook.caseFileCards]);

    expect(notebook.caseFileCards.size).toBe(0);
    expect(notebook.solution).toBeNull();
    expect(notebook.rooms.length).toBeGreaterThan(1);
  });
});
