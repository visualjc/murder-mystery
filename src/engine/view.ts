/**
 * Projections of game state for consumers that must NOT see everything.
 *
 * The CLI and the LLM game master are both untrusted with the case file and
 * with other players' hands (ADR-0001: leaking either into a prompt would spoil
 * the puzzle). They read a `PlayerView`, never `GameState`.
 *
 * `describeEvent` is also the narration fallback: when the game master returns
 * nothing or errors, the engine's own plain sentence is shown instead.
 */

import type { Card, Room, Suspect, Weapon } from './cards.ts';
import type { Position } from './board.ts';
import type { GameEvent, GameState, PlayerId, TurnPhase } from './types.ts';
import { IllegalActionError } from './types.ts';

/**
 * Whether one event is addressed to a given player — the whole visibility rule,
 * in one place. Exported so a consumer holding loose events (the narrator, which
 * is handed a turn's worth) applies the SAME rule the log projection does,
 * rather than trusting whoever passed them in.
 */
export function isVisibleTo(event: GameEvent, playerId: PlayerId): boolean {
  return event.visibleTo === 'all' || event.visibleTo.includes(playerId);
}

/** Events a given player is entitled to see, in order. */
export function visibleEvents(state: GameState, playerId: PlayerId): GameEvent[] {
  return state.events.filter((event) => isVisibleTo(event, playerId));
}

/** Events every player can see. Safe to show to a spectator or a narrator. */
export function publicEvents(state: GameState): GameEvent[] {
  return state.events.filter((event) => event.visibleTo === 'all');
}

/** The cards a player holds. Throws for an unknown player. */
export function handOf(state: GameState, playerId: PlayerId): readonly Card[] {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new IllegalActionError(`no such player: ${playerId}`);
  return player.hand;
}

export type PlayerView = {
  readonly you: PlayerId;
  readonly character: Suspect;
  readonly hand: readonly Card[];
  readonly position: Position;
  readonly eliminated: boolean;
  readonly phase: TurnPhase;
  readonly roll: number | null;
  readonly currentPlayer: PlayerId;
  readonly yourTurn: boolean;
  readonly turnNumber: number;
  readonly over: boolean;
  readonly winner: PlayerId | null;
  /** Public facts about the other seats: no hands, only hand SIZES. */
  readonly opponents: readonly {
    readonly id: PlayerId;
    readonly character: Suspect;
    readonly handSize: number;
    readonly eliminated: boolean;
    readonly position: Position;
  }[];
  readonly suspectPositions: Readonly<Record<Suspect, Position>>;
  readonly weaponPositions: Readonly<Record<Weapon, Room>>;
  readonly events: readonly GameEvent[];
  /**
   * The refutation the game is waiting on, or null. Everyone may know WHO owes
   * the choice — it is why play has stopped — but the cards on offer are part
   * of the refuter's hand, so `options` is filled in for that player alone.
   */
  readonly pendingRefutation: {
    readonly suggester: PlayerId;
    readonly refuter: PlayerId;
    readonly yours: boolean;
    readonly options: readonly Card[] | null;
  } | null;
};

/**
 * Everything one player may know: their own hand, public board state, and the
 * events addressed to them. The case file is absent by construction, and so is
 * every other hand.
 */
export function playerView(state: GameState, playerId: PlayerId): PlayerView {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new IllegalActionError(`no such player: ${playerId}`);
  const current = state.players[state.currentPlayerIndex];
  return {
    you: player.id,
    character: player.character,
    hand: player.hand,
    position: state.suspectPositions[player.character],
    eliminated: player.eliminated,
    phase: state.phase,
    roll: state.roll,
    currentPlayer: current?.id ?? player.id,
    yourTurn: current?.id === player.id,
    turnNumber: state.turnNumber,
    over: state.over,
    winner: state.winner,
    opponents: state.players
      .filter((candidate) => candidate.id !== playerId)
      .map((candidate) => ({
        id: candidate.id,
        character: candidate.character,
        handSize: candidate.hand.length,
        eliminated: candidate.eliminated,
        position: state.suspectPositions[candidate.character],
      })),
    suspectPositions: state.suspectPositions,
    weaponPositions: state.weaponPositions,
    events: visibleEvents(state, playerId),
    pendingRefutation:
      state.pendingRefutation === null
        ? null
        : {
            suggester: state.pendingRefutation.suggester,
            refuter: state.pendingRefutation.refuter,
            yours: state.pendingRefutation.refuter === playerId,
            options:
              state.pendingRefutation.refuter === playerId ? state.pendingRefutation.options : null,
          },
  };
}

/** A position as a short human phrase, e.g. "the Library" or "corridor 6,7". */
export function describePosition(position: Position): string {
  return position.kind === 'room' ? `the ${position.room}` : `corridor ${position.x},${position.y}`;
}

/** One event as a plain English sentence — the narration fallback. */
export function describeEvent(event: GameEvent): string {
  switch (event.type) {
    case 'game-started':
      return `The game begins with ${event.players
        .map((entry) => `${entry.id} as ${entry.character}`)
        .join(', ')}.`;
    case 'turn-started':
      return `Turn ${event.turn}: it is ${event.player}'s move.`;
    case 'rolled':
      return `${event.player} rolls a ${event.value}.`;
    case 'moved':
      return `${event.player} moves ${event.steps} ${
        event.steps === 1 ? 'step' : 'steps'
      } from ${describePosition(event.from)} to ${describePosition(event.to)}.`;
    case 'secret-passage':
      return `${event.player} slips through the secret passage from the ${event.from} to the ${event.to}.`;
    case 'suggestion-made':
      return `${event.player} suggests ${event.suspect} in the ${event.room} with the ${event.weapon}.`;
    case 'token-relocated':
      return `${event.token} is moved to the ${event.to}.`;
    case 'suggestion-refuted':
      return `${event.refuter} refutes ${event.player}'s suggestion with a card shown in private.`;
    case 'refutation-card-shown':
      return `${event.refuter} shows you the ${event.card}.`;
    case 'suggestion-unrefuted':
      return `No one can refute ${event.player}'s suggestion.`;
    case 'accusation-made':
      return `${event.player} accuses ${event.suspect} in the ${event.room} with the ${event.weapon} — ${
        event.correct ? 'and is right' : 'and is wrong'
      }.`;
    case 'player-eliminated':
      return `${event.player} is out of the running, but must still refute suggestions.`;
    case 'turn-ended':
      return `${event.player}'s turn ends.`;
    case 'game-over':
      return event.winner === null
        ? `The game ends unsolved. It was ${event.caseFile.suspect} in the ${event.caseFile.room} with the ${event.caseFile.weapon}.`
        : `${event.winner} wins: ${event.caseFile.suspect} in the ${event.caseFile.room} with the ${event.caseFile.weapon}.`;
  }
}

/** A player's whole visible history as plain sentences. */
export function describeLog(state: GameState, playerId: PlayerId): string[] {
  return visibleEvents(state, playerId).map(describeEvent);
}

/** Every card whose location a player has proven, and where it is. */
export function knownCards(state: GameState, playerId: PlayerId): Map<Card, PlayerId> {
  const known = new Map<Card, PlayerId>();
  for (const card of handOf(state, playerId)) known.set(card, playerId);
  for (const event of visibleEvents(state, playerId)) {
    if (event.type === 'refutation-card-shown') known.set(event.card, event.refuter);
  }
  return known;
}

