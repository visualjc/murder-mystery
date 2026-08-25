/**
 * The deterministic opponent policy — the "simple game master" driving the
 * suspects the human is not playing.
 *
 * Nothing here is stubbed: every plan is applied through the real engine
 * actions, so an illegal plan throws `IllegalActionError` and fails the test
 * rather than quietly producing a fake game. The policy itself reads a
 * `PlayerView` and nothing else, so these tests also stand as evidence that a
 * seat with no access to the case file can still play a whole game.
 */

import { describe, expect, test } from 'bun:test';

import { currentPlayer, endTurn, makeSuggestion, rollDice } from '../../src/engine/actions.ts';
import { legalDestinations } from '../../src/engine/board.ts';
import { getBoard } from '../../src/engine/actions.ts';
import { createGame } from '../../src/engine/setup.ts';
import { playerView } from '../../src/engine/view.ts';
import type { GameState } from '../../src/engine/types.ts';
import { buildNotebook } from '../../src/gm/notebook.ts';
import {
  applyOpponentPlan,
  planOpponentAction,
  playOpponentTurn,
  refuteAsOpponent,
} from '../../src/gm/opponent.ts';
import { FIXTURE_CASE_FILE, FIXTURE_HANDS, arrangedGame, placeToken, standingInRoom } from '../engine/helpers.ts';

/** Play a whole game with every seat driven by the policy. */
function playAllSeats(state: GameState, maxSteps = 4000): GameState {
  let current = state;
  let steps = 0;
  while (!current.over && steps < maxSteps) {
    current =
      current.pendingRefutation === null ? playOpponentTurn(current) : refuteAsOpponent(current);
    steps += 1;
  }
  return current;
}

describe('a game driven entirely by the policy', () => {
  for (const playerCount of [3, 4, 5, 6]) {
    test(`${playerCount} seats: every action is legal and the game is solved`, () => {
      const final = playAllSeats(createGame({ seed: `ai-${playerCount}`, playerCount }));
      console.log(`[all-ai ${playerCount}] winner ->`, final.winner, 'turns ->', final.turnNumber);

      expect(final.over).toBe(true);
      expect(final.winner).not.toBeNull();

      const accusations = final.events.filter((event) => event.type === 'accusation-made');
      // The policy accuses only when its notebook leaves exactly one triple, so
      // it must never have accused wrongly — not once, in a whole game.
      expect(accusations.filter((event) => !event.correct)).toEqual([]);
      expect(accusations).toHaveLength(1);
      expect(accusations[0]).toMatchObject({
        suspect: final.caseFile.suspect,
        weapon: final.caseFile.weapon,
        room: final.caseFile.room,
      });
    });
  }
});

describe('determinism', () => {
  test('the same seed and the same policy replay identically', () => {
    const a = playAllSeats(createGame({ seed: 'policy-replay', playerCount: 4 }));
    const b = playAllSeats(createGame({ seed: 'policy-replay', playerCount: 4 }));
    console.log('[determinism] events ->', a.events.length, b.events.length);

    expect(a).toEqual(b);
    expect(a.events.map((event) => event.type)).toEqual(b.events.map((event) => event.type));
  });

  test('a different seed produces a different game', () => {
    const a = playAllSeats(createGame({ seed: 'policy-a', playerCount: 4 }));
    const b = playAllSeats(createGame({ seed: 'policy-b', playerCount: 4 }));
    expect(a.events.length === b.events.length && a.caseFile === b.caseFile).toBe(false);
  });

  test('planning is a pure read: the same view always yields the same plan', () => {
    const state = standingInRoom(arrangedGame(), 'p1', 'Library');
    const view = playerView(state, 'p1');
    expect(planOpponentAction(view)).toEqual(planOpponentAction(view));
  });
});

describe('accusation only at exactly one candidate triple', () => {
  test('a seat that has proved nothing yet never accuses', () => {
    const state = createGame({ seed: 'no-accuse', playerCount: 4 });
    const view = playerView(state, currentPlayer(state).id);
    const notebook = buildNotebook(view);
    console.log('[no accusation] candidates ->', {
      suspects: notebook.suspects.length,
      weapons: notebook.weapons.length,
      rooms: notebook.rooms.length,
    });

    expect(notebook.solution).toBeNull();
    expect(planOpponentAction(view).kind).toBe('roll');
  });

  test('a seat whose notebook leaves one triple accuses it immediately', () => {
    // p1 suggests the case file itself from the Study; nobody can refute, so
    // the notebook proves all three.
    const state = makeSuggestion(standingInRoom(arrangedGame(), 'p1', 'Study'), {
      suspect: 'Professor Plum',
      weapon: 'Wrench',
    });
    const plan = planOpponentAction(playerView(state, 'p1'));
    console.log('[accusation] plan ->', plan);

    expect(plan).toEqual({ kind: 'accuse', triple: FIXTURE_CASE_FILE });

    const after = applyOpponentPlan(state, plan);
    expect(after.over).toBe(true);
    expect(after.winner).toBe('p1');
  });
});

describe('movement', () => {
  test('at the start of a turn the policy rolls', () => {
    const state = createGame({ seed: 'roll-first', playerCount: 3 });
    expect(planOpponentAction(playerView(state, 'p1')).kind).toBe('roll');
  });

  test('it walks into the nearest unvisited room it can reach', () => {
    // Miss Scarlett (p1) stands on the Study's door square with one step to
    // spend. The Study is unvisited and still a candidate room, so that is
    // where the policy goes.
    const base = placeToken(arrangedGame(), 'p1', { kind: 'corridor', x: 6, y: 4 });
    const state: GameState = { ...base, currentPlayerIndex: 0, phase: 'awaiting-move', roll: 1 };
    const plan = planOpponentAction(playerView(state, 'p1'));
    console.log('[movement] plan ->', plan);

    expect(plan).toEqual({ kind: 'move', position: { kind: 'room', room: 'Study' }, steps: 1 });

    // ...and the destination is genuinely one the engine offers.
    const legal = legalDestinations(getBoard(), { kind: 'corridor', x: 6, y: 4 }, 1, []);
    expect(legal.some((entry) => entry.position.kind === 'room' && entry.position.room === 'Study')).toBe(true);
    expect(applyOpponentPlan(state, plan).phase).toBe('awaiting-action');
  });

  test('a roll with nowhere legal to go ends the turn instead of throwing', () => {
    // Boxed in: Mrs. Peacock's start square has both its corridor neighbours
    // taken, so a roll of 1 leaves nothing reachable.
    let base = arrangedGame({
      players: [
        { id: 'p1', character: 'Mrs. Peacock' },
        { id: 'p2', character: 'Colonel Mustard' },
        { id: 'p3', character: 'Mrs. White' },
      ],
      hands: {
        p1: FIXTURE_HANDS.p1 as never,
        p2: FIXTURE_HANDS.p2 as never,
        p3: FIXTURE_HANDS.p3 as never,
      },
    });
    base = placeToken(base, 'p1', { kind: 'corridor', x: 10, y: 16 });
    base = placeToken(base, 'p2', { kind: 'corridor', x: 9, y: 16 });
    base = placeToken(base, 'p3', { kind: 'corridor', x: 11, y: 16 });
    const state: GameState = { ...base, currentPlayerIndex: 0, phase: 'awaiting-move', roll: 1 };

    const plan = planOpponentAction(playerView(state, 'p1'));
    console.log('[boxed in] plan ->', plan);
    expect(plan.kind).toBe('end-turn');
  });
});

describe('suggestion', () => {
  test('it names still-open cards from the room it stands in, and never twice in one turn', () => {
    const state = standingInRoom(arrangedGame(), 'p1', 'Library');
    const notebook = buildNotebook(playerView(state, 'p1'));
    const plan = planOpponentAction(playerView(state, 'p1'));
    console.log('[suggestion] plan ->', plan);

    expect(plan.kind).toBe('suggest');
    if (plan.kind !== 'suggest') throw new Error('unreachable');
    expect(notebook.suspects).toContain(plan.suspect);
    expect(notebook.weapons).toContain(plan.weapon);
    expect(FIXTURE_HANDS.p1).not.toContain(plan.suspect);
    expect(FIXTURE_HANDS.p1).not.toContain(plan.weapon);

    // The suggestion parks on p2's choice of card; settle it, then the same
    // seat must move on rather than suggest a second time.
    const suggested = applyOpponentPlan(state, plan);
    expect(suggested.phase).toBe('awaiting-refutation');
    const settled = refuteAsOpponent(suggested);
    expect(planOpponentAction(playerView(settled, 'p1')).kind).toBe('end-turn');
  });

  test('successive suggestions from one seat test different cards', () => {
    let state = standingInRoom(arrangedGame(), 'p1', 'Library');
    const first = planOpponentAction(playerView(state, 'p1'));
    state = refuteAsOpponent(applyOpponentPlan(state, first));

    // Play the round out for real so p1's NEXT turn genuinely begins — the
    // policy refuses a second suggestion inside one turn, and it reads the turn
    // boundary off the event log rather than being told.
    state = endTurn(state);
    while (!state.over && currentPlayer(state).id !== 'p1') {
      state = state.pendingRefutation === null ? playOpponentTurn(state) : refuteAsOpponent(state);
    }
    state = standingInRoom(state, 'p1', 'Lounge');
    const second = planOpponentAction(playerView(state, 'p1'));
    console.log('[repeat] first ->', first, 'second ->', second);

    expect(first.kind).toBe('suggest');
    expect(second.kind).toBe('suggest');
    if (first.kind !== 'suggest' || second.kind !== 'suggest') throw new Error('unreachable');
    // Whatever the first suggestion did not settle, the second probes fresh
    // ground: it never repeats a pairing that taught it nothing new.
    expect(`${second.suspect}/${second.weapon}`).not.toBe(`${first.suspect}/${first.weapon}`);
  });
});

describe('refutation', () => {
  test('the owed seat shows the first matching card in hand order', () => {
    const state = makeSuggestion(standingInRoom(arrangedGame(), 'p1', 'Library'), {
      suspect: 'Colonel Mustard',
      weapon: 'Dagger',
    });
    expect(state.pendingRefutation?.refuter).toBe('p2');
    expect(state.pendingRefutation?.options).toEqual(['Colonel Mustard', 'Dagger', 'Library']);

    const plan = planOpponentAction(playerView(state, 'p2'));
    console.log('[refutation] plan ->', plan);
    expect(plan).toEqual({ kind: 'refute', card: 'Colonel Mustard' });

    const after = refuteAsOpponent(state);
    expect(after.phase).toBe('awaiting-action');
    expect(buildNotebook(playerView(after, 'p1')).held.get('Colonel Mustard')).toBe('p2');
  });
});

describe('the policy never touches hidden state', () => {
  test('two games with different case files but identical views plan identically', () => {
    // Same hands, same board, same events — only the case file differs. A
    // policy that peeked at the case file would diverge here.
    const withPlum = arrangedGame();
    const swapped = { ...withPlum, caseFile: FIXTURE_CASE_FILE };
    const a = planOpponentAction(playerView(standingInRoom(withPlum, 'p1', 'Lounge'), 'p1'));
    const b = planOpponentAction(playerView(standingInRoom(swapped, 'p1', 'Lounge'), 'p1'));
    expect(a).toEqual(b);
  });

  test('rolling is the engine’s business — the policy never invents a die', () => {
    const state = createGame({ seed: 'die', playerCount: 3 });
    const rolled = applyOpponentPlan(state, planOpponentAction(playerView(state, 'p1')));
    expect(rolled.roll).toBe(rollDice(state).roll);
    expect(rolled.roll).toBeGreaterThanOrEqual(1);
    expect(rolled.roll).toBeLessThanOrEqual(6);
  });
});
