/**
 * Test fixtures. These are NOT mocks: every value here is a real `GameState`
 * produced by the real `createGame` and then re-arranged into a position the
 * engine could genuinely reach, so that a test can name the exact hands and
 * board placement it wants to reason about. The invariants the engine relies on
 * (closed world: every card in the case file or in exactly one hand) are
 * asserted when the fixture is built, so a mis-authored fixture fails loudly
 * rather than producing a fake pass.
 */

import { createGame, type NewPlayer } from '../../src/engine/setup.ts';
import { fullDeck, type Card, type Room, type SolutionTriple } from '../../src/engine/cards.ts';
import { inRoom, type Position } from '../../src/engine/board.ts';
import type { GameState, PlayerId } from '../../src/engine/types.ts';

export const THREE_SEATS: NewPlayer[] = [
  { id: 'p1', character: 'Miss Scarlett' },
  { id: 'p2', character: 'Colonel Mustard' },
  { id: 'p3', character: 'Mrs. White' },
];

/** The fixture case file used by most action tests. */
export const FIXTURE_CASE_FILE: SolutionTriple = {
  suspect: 'Professor Plum',
  weapon: 'Wrench',
  room: 'Study',
};

/** A partition of the other 18 cards across three seats. */
export const FIXTURE_HANDS: Record<PlayerId, Card[]> = {
  p1: ['Miss Scarlett', 'Candlestick', 'Kitchen', 'Ballroom', 'Conservatory', 'Dining Room'],
  p2: ['Colonel Mustard', 'Dagger', 'Billiard Room', 'Library', 'Lounge', 'Hall'],
  p3: ['Mrs. White', 'Reverend Green', 'Mrs. Peacock', 'Lead Pipe', 'Revolver', 'Rope'],
};

export type ArrangedGameOptions = {
  readonly seed?: number | string;
  readonly players?: readonly NewPlayer[];
  readonly caseFile?: SolutionTriple;
  readonly hands?: Record<PlayerId, Card[]>;
};

/**
 * A real game whose case file and hands are pinned to known values.
 * Throws if the arrangement is not a valid partition of the 21-card deck.
 */
export function arrangedGame(options: ArrangedGameOptions = {}): GameState {
  const players = options.players ?? THREE_SEATS;
  const caseFile = options.caseFile ?? FIXTURE_CASE_FILE;
  const hands = options.hands ?? FIXTURE_HANDS;

  const dealt = players.flatMap((player) => hands[player.id] ?? []);
  const all = [...dealt, caseFile.suspect, caseFile.weapon, caseFile.room].sort();
  const deck = fullDeck().sort();
  if (all.length !== deck.length || all.some((card, index) => card !== deck[index])) {
    throw new Error('fixture is not a valid partition of the deck');
  }

  const base = createGame({ seed: options.seed ?? 'fixture', players });
  return {
    ...base,
    caseFile,
    players: base.players.map((player) => ({ ...player, hand: hands[player.id] ?? [] })),
  };
}

/** Put a token on the board without walking it there. */
export function placeToken(state: GameState, playerId: PlayerId, position: Position): GameState {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error(`no such player: ${playerId}`);
  return {
    ...state,
    suspectPositions: { ...state.suspectPositions, [player.character]: position },
  };
}

/**
 * The state a player is in immediately after moving into `room` on their own
 * turn: it is their turn, they have moved, and a suggestion is open to them.
 */
export function standingInRoom(state: GameState, playerId: PlayerId, room: Room): GameState {
  const seat = state.players.findIndex((candidate) => candidate.id === playerId);
  if (seat < 0) throw new Error(`no such player: ${playerId}`);
  const placed = placeToken(state, playerId, inRoom(room));
  return {
    ...placed,
    currentPlayerIndex: seat,
    phase: 'awaiting-action',
    roll: null,
    players: placed.players.map((candidate) =>
      candidate.id === playerId
        ? { ...candidate, hasMovedThisTurn: true, hasSuggestedThisTurn: false }
        : candidate,
    ),
  };
}

/** Hand the turn to `playerId` at the start of their turn. */
export function turnOf(state: GameState, playerId: PlayerId): GameState {
  const seat = state.players.findIndex((candidate) => candidate.id === playerId);
  if (seat < 0) throw new Error(`no such player: ${playerId}`);
  return { ...state, currentPlayerIndex: seat, phase: 'awaiting-roll', roll: null };
}

/** Event types in order — a compact way to assert on the log. */
export function eventTypes(state: GameState): string[] {
  return state.events.map((event) => event.type);
}
