/**
 * Game setup: build the case file, deal the rest of the deck, place tokens.
 *
 * The order of RNG draws below is part of the engine's contract — change it and
 * previously recorded seeds replay into different games.
 *   1. case-file suspect, 2. case-file weapon, 3. case-file room,
 *   4. shuffle of the remaining 18 cards, 5. shuffle of the rooms for weapons.
 */

import {
  ROOMS,
  SUSPECTS,
  WEAPONS,
  isSuspect,
  type Card,
  type Room,
  type SolutionTriple,
  type Suspect,
  type Weapon,
} from './cards.ts';
import { START_SQUARES, corridorAt, type Position } from './board.ts';
import { createRng, pick, shuffle, type RngState } from './rng.ts';
import type { GameEvent, GameState, Player, PlayerId } from './types.ts';
import { IllegalActionError } from './types.ts';

export type NewPlayer = {
  readonly id: PlayerId;
  readonly character: Suspect;
};

export type NewGameOptions = {
  readonly seed: number | string;
  /** Explicit roster. Mutually exclusive with `playerCount`. */
  readonly players?: readonly NewPlayer[];
  /** Roster size; ids default to `p1..pN`, characters to the first N suspects. */
  readonly playerCount?: number;
};

/**
 * Classic Clue's minimum. Two seats would split all 18 undealt cards between
 * them, so each player could name the other's whole hand by subtracting their
 * own from the deck — the deduction game disappears. Three is the smallest
 * roster where a hand stays hidden.
 */
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = SUSPECTS.length;

/** Default roster for a given size: p1..pN taking suspects in deck order. */
export function defaultRoster(playerCount: number): NewPlayer[] {
  assertPlayerCount(playerCount);
  return Array.from({ length: playerCount }, (_unused, index) => ({
    id: `p${index + 1}`,
    character: SUSPECTS[index] as Suspect,
  }));
}

function assertPlayerCount(playerCount: number): void {
  if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new IllegalActionError(
      `player count must be an integer in [${MIN_PLAYERS}, ${MAX_PLAYERS}], got ${playerCount}`,
    );
  }
}

function assertRoster(roster: readonly NewPlayer[]): void {
  assertPlayerCount(roster.length);
  const ids = new Set<string>();
  const characters = new Set<string>();
  for (const entry of roster) {
    if (typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new IllegalActionError('every player needs a non-empty id');
    }
    if (!isSuspect(entry.character)) {
      throw new IllegalActionError(`not a suspect: ${String(entry.character)}`);
    }
    if (ids.has(entry.id)) throw new IllegalActionError(`duplicate player id: ${entry.id}`);
    if (characters.has(entry.character)) {
      throw new IllegalActionError(`duplicate character: ${entry.character}`);
    }
    ids.add(entry.id);
    characters.add(entry.character);
  }
}

/**
 * Draw the case file and return it with the cards that remain to be dealt.
 * Exactly one card of each category leaves the deck; 18 cards remain.
 */
export function drawCaseFile(rng: RngState): {
  caseFile: SolutionTriple;
  remaining: Card[];
  rng: RngState;
} {
  const [suspect, afterSuspect] = pick(SUSPECTS, rng);
  const [weapon, afterWeapon] = pick(WEAPONS, afterSuspect);
  const [room, afterRoom] = pick(ROOMS, afterWeapon);
  const caseFile: SolutionTriple = { suspect, weapon, room };
  const remaining: Card[] = [
    ...SUSPECTS.filter((candidate) => candidate !== suspect),
    ...WEAPONS.filter((candidate) => candidate !== weapon),
    ...ROOMS.filter((candidate) => candidate !== room),
  ];
  return { caseFile, remaining, rng: afterRoom };
}

/**
 * Deal cards round-robin starting at seat 0. Hands are uneven whenever the
 * seat count does not divide the card count; that is the normal Clue outcome,
 * not an error.
 */
export function dealRoundRobin(cards: readonly Card[], seats: number): Card[][] {
  if (!Number.isInteger(seats) || seats < 1) {
    throw new IllegalActionError(`seats must be a positive integer, got ${seats}`);
  }
  const hands: Card[][] = Array.from({ length: seats }, () => []);
  cards.forEach((card, index) => {
    (hands[index % seats] as Card[]).push(card);
  });
  return hands;
}

/** Scatter the six weapons across six distinct rooms. */
export function placeWeapons(rng: RngState): {
  weaponPositions: Record<Weapon, Room>;
  rng: RngState;
} {
  const [shuffledRooms, next] = shuffle(ROOMS, rng);
  const weaponPositions = {} as Record<Weapon, Room>;
  WEAPONS.forEach((weapon, index) => {
    weaponPositions[weapon] = shuffledRooms[index] as Room;
  });
  return { weaponPositions, rng: next };
}

/** Suspect tokens all start on their fixed corridor squares. */
export function startingSuspectPositions(): Record<Suspect, Position> {
  const positions = {} as Record<Suspect, Position>;
  for (const suspect of SUSPECTS) {
    const square = START_SQUARES[suspect];
    positions[suspect] = corridorAt(square.x, square.y);
  }
  return positions;
}

/**
 * Build a fresh game. Deterministic in the seed: the same seed and roster
 * always produce the same case file, the same hands and the same weapon
 * placement.
 */
export function createGame(options: NewGameOptions): GameState {
  if (options.players && options.playerCount !== undefined) {
    throw new IllegalActionError('pass players or playerCount, not both');
  }
  const roster = options.players ?? defaultRoster(options.playerCount ?? 3);
  assertRoster(roster);

  const seeded = createRng(options.seed);
  const { caseFile, remaining, rng: afterCaseFile } = drawCaseFile(seeded);
  const [shuffled, afterShuffle] = shuffle(remaining, afterCaseFile);
  const hands = dealRoundRobin(shuffled, roster.length);
  const { weaponPositions, rng: afterWeapons } = placeWeapons(afterShuffle);

  const players: Player[] = roster.map((entry, index) => ({
    id: entry.id,
    character: entry.character,
    hand: hands[index] as Card[],
    eliminated: false,
    movedBySuggestion: false,
    hasSuggestedThisTurn: false,
    hasMovedThisTurn: false,
  }));

  const events: GameEvent[] = [
    {
      type: 'game-started',
      visibleTo: 'all',
      players: players.map((player) => ({ id: player.id, character: player.character })),
    },
    { type: 'turn-started', visibleTo: 'all', player: players[0]?.id as PlayerId, turn: 1 },
  ];

  return {
    players,
    currentPlayerIndex: 0,
    phase: 'awaiting-roll',
    roll: null,
    caseFile,
    suspectPositions: startingSuspectPositions(),
    weaponPositions,
    rng: afterWeapons,
    events,
    winner: null,
    over: false,
    turnNumber: 1,
  };
}
