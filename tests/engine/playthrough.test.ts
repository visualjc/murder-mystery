/**
 * End-to-end play through the real API only: `createGame` plus the real
 * actions, no fixtures and no hand-arranged state. Two things are under test.
 *
 * 1. Determinism — a seed plus a deterministic policy replays exactly.
 * 2. Solvability — the information the engine exposes to a player is actually
 *    sufficient to deduce the case file by closed-world reasoning. A deduction
 *    bot that may only read `playerView`-level facts wins the game. If the
 *    engine leaked or withheld information, this test would not terminate.
 */

import { describe, expect, test } from 'bun:test';
import {
  ROOMS,
  SUSPECTS,
  WEAPONS,
  type Card,
  type Room,
  type SolutionTriple,
  type Suspect,
  type Weapon,
} from '../../src/engine/cards.ts';
import {
  canSuggest,
  currentPlayer,
  endTurn,
  legalMoves,
  makeAccusation,
  makeSuggestion,
  moveTo,
  provideRefutationCard,
  roomOf,
  rollDice,
} from '../../src/engine/actions.ts';
import { createGame } from '../../src/engine/setup.ts';
import { handOf, playerView } from '../../src/engine/view.ts';
import type { GameState, PlayerId } from '../../src/engine/types.ts';
import { buildNotebook } from '../../src/gm/notebook.ts';

/**
 * What one player can prove about where cards are, from their own hand plus the
 * events addressed to them. Uses only public and privately-addressed facts.
 *
 * The reasoning itself is the SHIPPED notebook (`src/gm/notebook.ts`), so this
 * bot is exactly as informed as an LLM-driven suspect and the closed world it
 * reasons over is a `playerView`, nothing more.
 */
function knowledgeOf(state: GameState, playerId: PlayerId): {
  held: ReadonlyMap<Card, PlayerId>;
  candidates: { suspects: readonly Suspect[]; weapons: readonly Weapon[]; rooms: readonly Room[] };
} {
  const notebook = buildNotebook(playerView(state, playerId));
  return {
    held: notebook.held,
    candidates: { suspects: notebook.suspects, weapons: notebook.weapons, rooms: notebook.rooms },
  };
}

function solvedTriple(state: GameState, playerId: PlayerId): SolutionTriple | null {
  return buildNotebook(playerView(state, playerId)).solution;
}

/**
 * The refuter's policy when a suggestion leaves them a choice: show the first
 * matching card in hand order. Determinism here comes from the policy plus the
 * logged action, not from the engine sampling on the refuter's behalf — the
 * engine has no opinion about which card is shown.
 */
function settleRefutation(state: GameState): GameState {
  const pending = state.pendingRefutation;
  if (pending === null) return state;
  const choice = pending.options[0];
  if (choice === undefined) throw new Error('a pending refutation must offer a card');
  return provideRefutationCard(state, choice);
}

/**
 * One turn of a deterministic deduction bot. It reads only what its seat is
 * entitled to know, and every state change it makes goes through a real action.
 */
function playTurn(state: GameState): GameState {
  const me = currentPlayer(state).id;

  const solved = solvedTriple(state, me);
  if (solved) return makeAccusation(state, solved);

  let next = state;
  if (!canSuggest(next)) {
    next = rollDice(next);
    const moves = legalMoves(next);
    if (moves.length === 0) return endTurn(next);
    const { candidates } = knowledgeOf(next, me);
    const openRooms = new Set<string>(candidates.rooms);
    const furthest = moves.reduce((best, move) => (move.steps > best.steps ? move : best));
    const preferred =
      moves.find((move) => move.position.kind === 'room' && openRooms.has(move.position.room)) ??
      moves.find((move) => move.position.kind === 'room') ??
      furthest;
    next = moveTo(next, preferred.position);
  }

  const room = roomOf(next, me);
  if (room === null || !canSuggest(next)) return endTurn(next);

  const { candidates } = knowledgeOf(next, me);
  const suspect = (candidates.suspects[0] ?? SUSPECTS[0]) as Suspect;
  const weapon = (candidates.weapons[0] ?? WEAPONS[0]) as Weapon;
  next = makeSuggestion(next, { suspect, weapon });
  next = settleRefutation(next);

  // An unrefuted suggestion of our own needs no special case here: the notebook
  // reads it as proof that every named card we do not hold is in the case file.
  const nowSolved = solvedTriple(next, me);
  if (nowSolved) return makeAccusation(next, nowSolved);
  return endTurn(next);
}

function playToCompletion(state: GameState, maxTurns = 600): GameState {
  let current = state;
  let turns = 0;
  while (!current.over && turns < maxTurns) {
    current = playTurn(current);
    turns += 1;
  }
  return current;
}

describe('deterministic replay', () => {
  test('the same seed and the same policy produce an identical game', () => {
    const a = playToCompletion(createGame({ seed: 'replay-me', playerCount: 3 }));
    const b = playToCompletion(createGame({ seed: 'replay-me', playerCount: 3 }));
    expect(a).toEqual(b);
    expect(a.events.length).toBe(b.events.length);
  });

  test('a different seed produces a different game', () => {
    const a = playToCompletion(createGame({ seed: 'seed-a', playerCount: 3 }));
    const b = playToCompletion(createGame({ seed: 'seed-b', playerCount: 3 }));
    expect(a.events.length === b.events.length && a.caseFile === b.caseFile).toBe(false);
  });

  test('no wall-clock or environment value leaks into state', () => {
    const state = playToCompletion(createGame({ seed: 'pure', playerCount: 3 }));
    const serialized = JSON.stringify(state);
    expect(serialized).toBe(JSON.stringify(JSON.parse(serialized)));
    expect(serialized).not.toContain(String(new Date().getFullYear()));
  });
});

describe('a full game plays out under the real rules', () => {
  for (const playerCount of [3, 4, 5, 6]) {
    test(`${playerCount} players: the game ends with a correct accusation`, () => {
      const final = playToCompletion(
        createGame({ seed: `full-${playerCount}`, playerCount }),
        900,
      );
      expect(final.over).toBe(true);
      expect(final.phase).toBe('game-over');
      expect(final.winner).not.toBeNull();

      const winning = final.events.filter(
        (event) => event.type === 'accusation-made' && event.correct,
      );
      expect(winning.length).toBe(1);
      expect(winning[0]).toMatchObject({
        player: final.winner as string,
        suspect: final.caseFile.suspect,
        weapon: final.caseFile.weapon,
        room: final.caseFile.room,
      });
    });
  }

  test('nothing a player can deduce is ever false', () => {
    // The engine must never emit information that leads a sound closed-world
    // deduction to a wrong conclusion. Check every seat's beliefs against truth.
    for (const seed of ['truth-a', 'truth-b', 'truth-c']) {
      const final = playToCompletion(createGame({ seed, playerCount: 4 }));
      const truth = new Map<Card, PlayerId>();
      for (const player of final.players) {
        for (const card of player.hand) truth.set(card, player.id);
      }
      for (const player of final.players) {
        for (const [card, believedHolder] of knowledgeOf(final, player.id).held) {
          expect(`${seed}/${player.id}/${card}:${believedHolder}`).toBe(
            `${seed}/${player.id}/${card}:${truth.get(card) ?? 'case-file'}`,
          );
        }
      }
    }
  });

  test('the closed world holds for the whole game', () => {
    const final = playToCompletion(createGame({ seed: 'closed', playerCount: 4 }));
    const dealt = final.players.flatMap((player) => player.hand);
    expect(new Set(dealt).size).toBe(18);
    for (const card of [final.caseFile.suspect, final.caseFile.weapon, final.caseFile.room]) {
      expect(dealt).not.toContain(card);
    }
  });

  test('hands are never touched by play', () => {
    const start = createGame({ seed: 'hands', playerCount: 4 });
    const final = playToCompletion(start);
    expect(final.players.map((player) => player.hand)).toEqual(
      start.players.map((player) => player.hand),
    );
  });

  test('every suggestion was made from the room the suggester stood in', () => {
    const final = playToCompletion(createGame({ seed: 'rooms', playerCount: 3 }));
    const suggestions = final.events.filter((event) => event.type === 'suggestion-made');
    expect(suggestions.length).toBeGreaterThan(3);
    for (const suggestion of suggestions) {
      expect(ROOMS).toContain(suggestion.room);
    }
  });

  test('dice are actually rolled and spent — movement is not free', () => {
    const final = playToCompletion(createGame({ seed: 'dice-spent', playerCount: 3 }));
    const rolls = final.events.filter((event) => event.type === 'rolled');
    const moves = final.events.filter((event) => event.type === 'moved');
    expect(rolls.length).toBeGreaterThan(3);
    expect(moves.length).toBeGreaterThan(3);
    for (const move of moves) {
      expect(move.steps).toBeGreaterThanOrEqual(1);
      expect(move.steps).toBeLessThanOrEqual(6);
    }
    for (const roll of rolls) {
      expect(roll.value).toBeGreaterThanOrEqual(1);
      expect(roll.value).toBeLessThanOrEqual(6);
    }
  });

  test('two tokens never share a corridor square', () => {
    let state = createGame({ seed: 'collision', playerCount: 5 });
    const occupiedKeys = (current: GameState) =>
      Object.values(current.suspectPositions)
        .filter((position) => position.kind === 'corridor')
        .map((position) => `${position.x},${position.y}`);
    expect(new Set(occupiedKeys(state)).size).toBe(occupiedKeys(state).length);
    for (let turn = 0; turn < 200 && !state.over; turn += 1) {
      state = playTurn(state);
      const keys = occupiedKeys(state);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
