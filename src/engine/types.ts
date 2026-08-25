/**
 * The engine's state value and event vocabulary.
 *
 * `GameState` is plain data: no functions, no class instances, no dates, no
 * network handles. Every action is a pure `(state, args) => GameState`, so a
 * game is fully described by its seed plus the action sequence applied to it.
 */

import type { Card, Room, SolutionTriple, Suspect, Weapon } from './cards.ts';
import type { Position } from './board.ts';
import type { RngState } from './rng.ts';

export type PlayerId = string;

export type Player = {
  readonly id: PlayerId;
  /** The suspect token this player moves. Also a card in the deck. */
  readonly character: Suspect;
  readonly hand: readonly Card[];
  /** Wrong accusation: barred from winning, still obliged to refute. */
  readonly eliminated: boolean;
  /** Another player's suggestion pulled this token into a room. */
  readonly movedBySuggestion: boolean;
  readonly hasSuggestedThisTurn: boolean;
  readonly hasMovedThisTurn: boolean;
};

export type TurnPhase =
  /** Start of turn: roll, or take a secret passage, or accuse, or (if pulled here by a suggestion) suggest. */
  | 'awaiting-roll'
  /** A die has been rolled and the token must be moved. */
  | 'awaiting-move'
  /**
   * A suggestion found a refuter holding more than one matching card. The turn
   * is suspended until that refuter names which card they show.
   */
  | 'awaiting-refutation'
  /** Movement is settled: suggest (in a room), accuse, or end the turn. */
  | 'awaiting-action'
  | 'game-over';

/**
 * A refutation the engine cannot settle on its own: the refuter holds several
 * cards that answer the suggestion, and which one they show is their choice.
 * Recorded in state so the choice arrives as its own action (a value in the
 * action log) rather than as a callback the engine calls mid-suggestion.
 */
export type PendingRefutation = {
  readonly suggester: PlayerId;
  readonly refuter: PlayerId;
  /** The suspect, weapon and room the suggester named. */
  readonly triple: SolutionTriple;
  /** The refuter's matching cards, in hand order. Exactly one may be shown. */
  readonly options: readonly Card[];
};

/** Who may see an event. `'all'` is public knowledge; a list is private. */
export type Visibility = 'all' | readonly PlayerId[];

export type GameEvent =
  | { readonly type: 'game-started'; readonly visibleTo: Visibility; readonly players: readonly { readonly id: PlayerId; readonly character: Suspect }[] }
  | { readonly type: 'turn-started'; readonly visibleTo: Visibility; readonly player: PlayerId; readonly turn: number }
  | { readonly type: 'rolled'; readonly visibleTo: Visibility; readonly player: PlayerId; readonly value: number }
  | { readonly type: 'moved'; readonly visibleTo: Visibility; readonly player: PlayerId; readonly from: Position; readonly to: Position; readonly steps: number }
  | { readonly type: 'secret-passage'; readonly visibleTo: Visibility; readonly player: PlayerId; readonly from: Room; readonly to: Room }
  | { readonly type: 'suggestion-made'; readonly visibleTo: Visibility; readonly player: PlayerId; readonly suspect: Suspect; readonly weapon: Weapon; readonly room: Room }
  | { readonly type: 'token-relocated'; readonly visibleTo: Visibility; readonly token: Suspect | Weapon; readonly to: Room }
  | { readonly type: 'suggestion-refuted'; readonly visibleTo: Visibility; readonly player: PlayerId; readonly refuter: PlayerId }
  /** Private to the suggester and the refuter: which card was shown. */
  | { readonly type: 'refutation-card-shown'; readonly visibleTo: Visibility; readonly player: PlayerId; readonly refuter: PlayerId; readonly card: Card }
  | { readonly type: 'suggestion-unrefuted'; readonly visibleTo: Visibility; readonly player: PlayerId }
  | { readonly type: 'accusation-made'; readonly visibleTo: Visibility; readonly player: PlayerId; readonly suspect: Suspect; readonly weapon: Weapon; readonly room: Room; readonly correct: boolean }
  | { readonly type: 'player-eliminated'; readonly visibleTo: Visibility; readonly player: PlayerId }
  | { readonly type: 'turn-ended'; readonly visibleTo: Visibility; readonly player: PlayerId }
  | { readonly type: 'game-over'; readonly visibleTo: Visibility; readonly winner: PlayerId | null; readonly caseFile: SolutionTriple };

export type GameState = {
  readonly players: readonly Player[];
  readonly currentPlayerIndex: number;
  readonly phase: TurnPhase;
  /** The die value awaiting spend, or null outside `awaiting-move`. */
  readonly roll: number | null;
  /** The refutation choice owed by a refuter, or null outside `awaiting-refutation`. */
  readonly pendingRefutation: PendingRefutation | null;
  /**
   * The hidden answer. Engine-only: never render it, never put it in a prompt.
   * Use `playerView` to hand state to a UI or an LLM.
   */
  readonly caseFile: SolutionTriple;
  readonly suspectPositions: Readonly<Record<Suspect, Position>>;
  readonly weaponPositions: Readonly<Record<Weapon, Room>>;
  readonly rng: RngState;
  readonly events: readonly GameEvent[];
  readonly winner: PlayerId | null;
  readonly over: boolean;
  readonly turnNumber: number;
};

/** What a suggestion produced, as the suggester learns it. */
export type SuggestionOutcome = {
  readonly suggester: PlayerId;
  readonly suspect: Suspect;
  readonly weapon: Weapon;
  readonly room: Room;
  readonly refuter: PlayerId | null;
  /** The card shown, visible to the suggester and the refuter alone. */
  readonly card: Card | null;
};

/** Thrown when an action is not legal in the current state. */
export class IllegalActionError extends Error {
  override readonly name = 'IllegalActionError';
}
