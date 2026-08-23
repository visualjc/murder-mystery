import { describe, expect, test } from 'bun:test';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  createGame,
  dealRoundRobin,
  defaultRoster,
  drawCaseFile,
  placeWeapons,
  startingSuspectPositions,
} from '../../src/engine/setup.ts';
import { ROOMS, SUSPECTS, WEAPONS, cardCategory, fullDeck, type Card } from '../../src/engine/cards.ts';
import { START_SQUARES, corridorAt } from '../../src/engine/board.ts';
import { createRng } from '../../src/engine/rng.ts';
import { IllegalActionError } from '../../src/engine/types.ts';

describe('defaultRoster', () => {
  test('assigns p1..pN to the first N suspects', () => {
    expect(defaultRoster(3)).toEqual([
      { id: 'p1', character: 'Miss Scarlett' },
      { id: 'p2', character: 'Colonel Mustard' },
      { id: 'p3', character: 'Mrs. White' },
    ]);
  });

  test('supports every legal roster size', () => {
    for (let size = MIN_PLAYERS; size <= MAX_PLAYERS; size += 1) {
      expect(defaultRoster(size).length).toBe(size);
    }
  });

  test('rejects rosters outside the supported range', () => {
    expect(() => defaultRoster(1)).toThrow(IllegalActionError);
    expect(() => defaultRoster(7)).toThrow(IllegalActionError);
    expect(() => defaultRoster(3.5)).toThrow(IllegalActionError);
  });
});

describe('drawCaseFile', () => {
  test('takes exactly one card of each category and leaves 18', () => {
    const { caseFile, remaining } = drawCaseFile(createRng('case'));
    expect(cardCategory(caseFile.suspect)).toBe('suspect');
    expect(cardCategory(caseFile.weapon)).toBe('weapon');
    expect(cardCategory(caseFile.room)).toBe('room');
    expect(remaining.length).toBe(18);
    expect(new Set(remaining).size).toBe(18);
  });

  test('the case-file cards are not among the remaining cards', () => {
    const { caseFile, remaining } = drawCaseFile(createRng('case'));
    for (const card of [caseFile.suspect, caseFile.weapon, caseFile.room] as Card[]) {
      expect(remaining).not.toContain(card);
    }
  });

  test('case file plus remaining reconstitutes the whole deck', () => {
    const { caseFile, remaining } = drawCaseFile(createRng('whole'));
    const all = [...remaining, caseFile.suspect, caseFile.weapon, caseFile.room].sort();
    expect(all).toEqual(fullDeck().sort());
  });

  test('different seeds reach different case files across a sample', () => {
    const files = new Set(
      Array.from({ length: 40 }, (_unused, index) => {
        const { caseFile } = drawCaseFile(createRng(`seed-${index}`));
        return `${caseFile.suspect}|${caseFile.weapon}|${caseFile.room}`;
      }),
    );
    expect(files.size).toBeGreaterThan(10);
  });

  test('advances the RNG so the deal that follows is not correlated', () => {
    const rng = createRng('advance');
    expect(drawCaseFile(rng).rng.seed).not.toBe(rng.seed);
  });
});

describe('dealRoundRobin', () => {
  test('deals 18 cards evenly to three seats', () => {
    const hands = dealRoundRobin(fullDeck().slice(0, 18), 3);
    expect(hands.map((hand) => hand.length)).toEqual([6, 6, 6]);
  });

  test('leaves uneven hands when the seat count does not divide the cards', () => {
    expect(dealRoundRobin(fullDeck().slice(0, 18), 4).map((hand) => hand.length)).toEqual([5, 5, 4, 4]);
    expect(dealRoundRobin(fullDeck().slice(0, 18), 5).map((hand) => hand.length)).toEqual([4, 4, 4, 3, 3]);
    expect(dealRoundRobin(fullDeck().slice(0, 18), 6).map((hand) => hand.length)).toEqual([3, 3, 3, 3, 3, 3]);
  });

  test('deals strictly round-robin starting at seat 0', () => {
    const hands = dealRoundRobin(['a', 'b', 'c', 'd', 'e'] as unknown as Card[], 2);
    expect(hands[0]).toEqual(['a', 'c', 'e'] as unknown as Card[]);
    expect(hands[1]).toEqual(['b', 'd'] as unknown as Card[]);
  });

  test('every card lands in exactly one hand', () => {
    const cards = fullDeck().slice(0, 18);
    const hands = dealRoundRobin(cards, 4);
    expect(hands.flat().sort()).toEqual(cards.slice().sort());
  });

  test('rejects a non-positive seat count', () => {
    expect(() => dealRoundRobin([], 0)).toThrow(IllegalActionError);
  });
});

describe('placeWeapons', () => {
  test('puts all six weapons in six distinct rooms', () => {
    const { weaponPositions } = placeWeapons(createRng('weapons'));
    expect(Object.keys(weaponPositions).sort()).toEqual([...WEAPONS].sort());
    const rooms = Object.values(weaponPositions);
    expect(new Set(rooms).size).toBe(6);
    for (const room of rooms) expect(ROOMS).toContain(room);
  });

  test('is deterministic per seed', () => {
    expect(placeWeapons(createRng('w')).weaponPositions).toEqual(
      placeWeapons(createRng('w')).weaponPositions,
    );
  });
});

describe('startingSuspectPositions', () => {
  test('places every suspect on their fixed corridor start square', () => {
    const positions = startingSuspectPositions();
    for (const suspect of SUSPECTS) {
      const square = START_SQUARES[suspect];
      expect(positions[suspect]).toEqual(corridorAt(square.x, square.y));
    }
  });
});

describe('createGame', () => {
  test('is deterministic: the same seed and roster produce an identical state', () => {
    expect(createGame({ seed: 'identical', playerCount: 4 })).toEqual(
      createGame({ seed: 'identical', playerCount: 4 }),
    );
  });

  test('a different seed produces a different game', () => {
    const a = createGame({ seed: 'a', playerCount: 3 });
    const b = createGame({ seed: 'b', playerCount: 3 });
    expect(a.caseFile).not.toEqual(b.caseFile);
  });

  test('closed world: every card is in the case file or in exactly one hand', () => {
    const state = createGame({ seed: 'closed-world', playerCount: 5 });
    const dealt = state.players.flatMap((player) => player.hand);
    expect(dealt.length).toBe(18);
    expect(new Set(dealt).size).toBe(18);
    const all = [...dealt, state.caseFile.suspect, state.caseFile.weapon, state.caseFile.room].sort();
    expect(all).toEqual(fullDeck().sort());
  });

  test('no case-file card is ever in a hand, across many seeds', () => {
    for (let index = 0; index < 25; index += 1) {
      const state = createGame({ seed: `world-${index}`, playerCount: 3 });
      const dealt = new Set(state.players.flatMap((player) => player.hand));
      expect(dealt.has(state.caseFile.suspect)).toBe(false);
      expect(dealt.has(state.caseFile.weapon)).toBe(false);
      expect(dealt.has(state.caseFile.room)).toBe(false);
    }
  });

  test('starts on turn 1 with seat 0 awaiting a roll and nobody eliminated', () => {
    const state = createGame({ seed: 'start', playerCount: 3 });
    expect(state.currentPlayerIndex).toBe(0);
    expect(state.phase).toBe('awaiting-roll');
    expect(state.roll).toBeNull();
    expect(state.turnNumber).toBe(1);
    expect(state.over).toBe(false);
    expect(state.winner).toBeNull();
    expect(state.players.every((player) => !player.eliminated)).toBe(true);
    expect(state.players.every((player) => !player.hasMovedThisTurn)).toBe(true);
  });

  test('opens the log with the roster and the first turn', () => {
    const state = createGame({ seed: 'log', playerCount: 3 });
    expect(state.events.map((event) => event.type)).toEqual(['game-started', 'turn-started']);
    expect(state.events.every((event) => event.visibleTo === 'all')).toBe(true);
  });

  test('all six suspect tokens are on the board, not just the players', () => {
    const state = createGame({ seed: 'tokens', playerCount: 3 });
    expect(Object.keys(state.suspectPositions).sort()).toEqual([...SUSPECTS].sort());
    expect(Object.values(state.suspectPositions).every((position) => position.kind === 'corridor')).toBe(
      true,
    );
  });

  test('accepts an explicit roster with chosen characters', () => {
    const state = createGame({
      seed: 'roster',
      players: [
        { id: 'human', character: 'Professor Plum' },
        { id: 'gm-1', character: 'Mrs. Peacock' },
        { id: 'gm-2', character: 'Reverend Green' },
      ],
    });
    expect(state.players.map((player) => player.id)).toEqual(['human', 'gm-1', 'gm-2']);
    expect(state.players.map((player) => player.character)).toEqual([
      'Professor Plum',
      'Mrs. Peacock',
      'Reverend Green',
    ]);
  });

  test('rejects duplicate ids, duplicate characters and non-suspects', () => {
    const base = { id: 'a', character: 'Miss Scarlett' } as const;
    expect(() =>
      createGame({ seed: 1, players: [base, { id: 'a', character: 'Mrs. White' }] }),
    ).toThrow(IllegalActionError);
    expect(() =>
      createGame({ seed: 1, players: [base, { id: 'b', character: 'Miss Scarlett' }] }),
    ).toThrow(IllegalActionError);
    expect(() =>
      createGame({ seed: 1, players: [base, { id: 'b', character: 'Rope' as never }] }),
    ).toThrow(IllegalActionError);
    expect(() => createGame({ seed: 1, players: [{ id: '', character: 'Mrs. White' }, base] })).toThrow(
      IllegalActionError,
    );
  });

  test('rejects passing both a roster and a player count', () => {
    expect(() =>
      createGame({ seed: 1, playerCount: 3, players: defaultRoster(3) }),
    ).toThrow(IllegalActionError);
  });

  test('rejects a roster that is too small or too large', () => {
    expect(() => createGame({ seed: 1, playerCount: 1 })).toThrow(IllegalActionError);
    expect(() => createGame({ seed: 1, playerCount: 7 })).toThrow(IllegalActionError);
  });
});
