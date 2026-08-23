/**
 * The turn state machine. Every exported action is a pure function from a
 * `GameState` to the next `GameState`, throwing `IllegalActionError` when the
 * action is not legal. Nothing here reads a clock, a network, or an LLM.
 *
 * Turn shape (standard Clue):
 *   awaiting-roll  --rollDice-->        awaiting-move
 *   awaiting-roll  --takeSecretPassage->awaiting-action
 *   awaiting-move  --moveTo-->          awaiting-action
 *   awaiting-*     --makeSuggestion-->  awaiting-action   (only from a room)
 *   awaiting-*     --makeAccusation-->  next turn, or game-over
 *   awaiting-action--endTurn-->         next player's awaiting-roll
 */

import {
  isRoom,
  isSuspect,
  isWeapon,
  type Card,
  type Room,
  type SolutionTriple,
  type Suspect,
  type Weapon,
} from './cards.ts';
import {
  buildBoard,
  legalDestinations,
  positionKey,
  secretPassageFrom,
  type Board,
  type Destination,
  type Position,
} from './board.ts';
import { pick, rollDie } from './rng.ts';
import {
  IllegalActionError,
  type GameEvent,
  type GameState,
  type Player,
  type PlayerId,
  type SuggestionOutcome,
} from './types.ts';

let cachedBoard: Board | null = null;

/** The board. Built once from the static topology; identical every call. */
export function getBoard(): Board {
  if (cachedBoard === null) cachedBoard = buildBoard();
  return cachedBoard;
}

export function currentPlayer(state: GameState): Player {
  const player = state.players[state.currentPlayerIndex];
  if (!player) throw new IllegalActionError('no current player');
  return player;
}

export function playerById(state: GameState, playerId: PlayerId): Player {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new IllegalActionError(`no such player: ${playerId}`);
  return player;
}

/** Where a player's token stands. */
export function positionOf(state: GameState, playerId: PlayerId): Position {
  return state.suspectPositions[playerById(state, playerId).character];
}

/** The room a player occupies, or null when they are in the corridor. */
export function roomOf(state: GameState, playerId: PlayerId): Room | null {
  const position = positionOf(state, playerId);
  return position.kind === 'room' ? position.room : null;
}

/**
 * Corridor squares held by suspect tokens other than `exclude`. Corridor
 * squares hold one token, so these block both movement and passage.
 */
export function occupiedSquares(state: GameState, exclude?: Suspect): Position[] {
  const positions: Position[] = [];
  for (const [suspect, position] of Object.entries(state.suspectPositions)) {
    if (suspect === exclude) continue;
    if (position.kind === 'corridor') positions.push(position);
  }
  return positions;
}

/** Where the current player may finish, given the die they have already rolled. */
export function legalMoves(state: GameState): Destination[] {
  if (state.phase !== 'awaiting-move' || state.roll === null) return [];
  const player = currentPlayer(state);
  return legalDestinations(
    getBoard(),
    state.suspectPositions[player.character],
    state.roll,
    occupiedSquares(state, player.character),
  );
}

/** True when the current player may swap corner rooms instead of rolling. */
export function canTakeSecretPassage(state: GameState): boolean {
  if (state.over || state.phase !== 'awaiting-roll') return false;
  const player = currentPlayer(state);
  if (player.eliminated || player.hasMovedThisTurn) return false;
  const room = roomOf(state, player.id);
  return room !== null && secretPassageFrom(room) !== null;
}

/** True when the current player may name a suggestion right now. */
export function canSuggest(state: GameState): boolean {
  if (state.over) return false;
  const player = currentPlayer(state);
  if (player.eliminated || player.hasSuggestedThisTurn) return false;
  if (roomOf(state, player.id) === null) return false;
  if (state.phase === 'awaiting-action') return player.hasMovedThisTurn;
  if (state.phase === 'awaiting-roll') return player.movedBySuggestion;
  return false;
}

function assertActive(state: GameState): Player {
  if (state.over) throw new IllegalActionError('the game is over');
  const player = currentPlayer(state);
  if (player.eliminated) {
    throw new IllegalActionError(`${player.id} was eliminated and may only refute`);
  }
  return player;
}

function withPlayer(
  state: GameState,
  playerId: PlayerId,
  patch: Partial<Player>,
): readonly Player[] {
  return state.players.map((player) => (player.id === playerId ? { ...player, ...patch } : player));
}

function append(state: GameState, ...events: readonly GameEvent[]): GameEvent[] {
  return [...state.events, ...events];
}

/** Roll one die. Standard Clue rolls two; this game rolls one (see ADR notes). */
export function rollDice(state: GameState): GameState {
  const player = assertActive(state);
  if (state.phase !== 'awaiting-roll') {
    throw new IllegalActionError(`cannot roll in phase ${state.phase}`);
  }
  if (player.hasMovedThisTurn) throw new IllegalActionError(`${player.id} already moved this turn`);
  const [value, rng] = rollDie(state.rng);
  return {
    ...state,
    rng,
    roll: value,
    phase: 'awaiting-move',
    events: append(state, { type: 'rolled', visibleTo: 'all', player: player.id, value }),
  };
}

/** Spend the rolled die moving the current player's token to `destination`. */
export function moveTo(state: GameState, destination: Position): GameState {
  const player = assertActive(state);
  if (state.phase !== 'awaiting-move' || state.roll === null) {
    throw new IllegalActionError(`cannot move in phase ${state.phase}`);
  }
  const target = legalMoves(state).find(
    (candidate) => positionKey(candidate.position) === positionKey(destination),
  );
  if (!target) {
    throw new IllegalActionError(
      `${positionKey(destination)} is not reachable with a roll of ${state.roll}`,
    );
  }
  const from = state.suspectPositions[player.character];
  return {
    ...state,
    players: withPlayer(state, player.id, { hasMovedThisTurn: true, movedBySuggestion: false }),
    suspectPositions: { ...state.suspectPositions, [player.character]: target.position },
    roll: null,
    phase: 'awaiting-action',
    events: append(state, {
      type: 'moved',
      visibleTo: 'all',
      player: player.id,
      from,
      to: target.position,
      steps: target.steps,
    }),
  };
}

/** Cross the house by secret passage instead of rolling. */
export function takeSecretPassage(state: GameState): GameState {
  const player = assertActive(state);
  if (!canTakeSecretPassage(state)) {
    throw new IllegalActionError(`${player.id} cannot take a secret passage now`);
  }
  const from = roomOf(state, player.id) as Room;
  const to = secretPassageFrom(from) as Room;
  return {
    ...state,
    players: withPlayer(state, player.id, { hasMovedThisTurn: true, movedBySuggestion: false }),
    suspectPositions: { ...state.suspectPositions, [player.character]: { kind: 'room', room: to } },
    roll: null,
    phase: 'awaiting-action',
    events: append(state, { type: 'secret-passage', visibleTo: 'all', player: player.id, from, to }),
  };
}

/** Seats in refutation order: clockwise from the suggester, excluding them. */
export function refutationOrder(state: GameState, suggesterId: PlayerId): PlayerId[] {
  const seat = state.players.findIndex((player) => player.id === suggesterId);
  if (seat < 0) throw new IllegalActionError(`no such player: ${suggesterId}`);
  const order: PlayerId[] = [];
  for (let step = 1; step < state.players.length; step += 1) {
    const player = state.players[(seat + step) % state.players.length] as Player;
    order.push(player.id);
  }
  return order;
}

/** The cards in a hand that answer a triple, in deck order. */
export function matchingCards(hand: readonly Card[], triple: SolutionTriple): Card[] {
  const named = new Set<Card>([triple.suspect, triple.weapon, triple.room]);
  return hand.filter((card) => named.has(card));
}

export type SuggestionOptions = {
  /**
   * How a refuter picks which of several matching cards to show. Given the
   * refuter and their options; must return one of them. Omitted, the engine
   * chooses with the seeded RNG, which keeps replay exact.
   */
  readonly chooseRefutationCard?: (context: {
    readonly refuter: PlayerId;
    readonly options: readonly Card[];
  }) => Card;
};

/**
 * Name a suspect and a weapon in the room the suggester occupies.
 *
 * Relocates both named tokens into that room, then walks clockwise for the
 * first player holding any of the three named cards. That player shows exactly
 * one card privately; everyone else learns only that a card was shown, and by
 * whom. "Nobody could refute" is public.
 */
export function makeSuggestion(
  state: GameState,
  suggestion: { readonly suspect: Suspect; readonly weapon: Weapon },
  options: SuggestionOptions = {},
): GameState {
  const player = assertActive(state);
  if (!isSuspect(suggestion.suspect)) {
    throw new IllegalActionError(`not a suspect: ${String(suggestion.suspect)}`);
  }
  if (!isWeapon(suggestion.weapon)) {
    throw new IllegalActionError(`not a weapon: ${String(suggestion.weapon)}`);
  }
  if (!canSuggest(state)) {
    const room = roomOf(state, player.id);
    throw new IllegalActionError(
      room === null
        ? `${player.id} must be in a room to suggest`
        : `${player.id} cannot suggest in phase ${state.phase}`,
    );
  }
  const room = roomOf(state, player.id) as Room;
  const triple: SolutionTriple = { suspect: suggestion.suspect, weapon: suggestion.weapon, room };

  const events: GameEvent[] = [
    {
      type: 'suggestion-made',
      visibleTo: 'all',
      player: player.id,
      suspect: triple.suspect,
      weapon: triple.weapon,
      room,
    },
    { type: 'token-relocated', visibleTo: 'all', token: triple.suspect, to: room },
    { type: 'token-relocated', visibleTo: 'all', token: triple.weapon, to: room },
  ];

  // The named suspect is pulled into the room; if a player moves that token,
  // they may suggest from there on their own next turn without moving.
  let players = state.players.map((candidate) =>
    candidate.character === triple.suspect && candidate.id !== player.id
      ? { ...candidate, movedBySuggestion: true }
      : candidate,
  );
  players = players.map((candidate) =>
    candidate.id === player.id ? { ...candidate, hasSuggestedThisTurn: true } : candidate,
  );

  let rng = state.rng;
  let refuter: PlayerId | null = null;
  let shown: Card | null = null;
  for (const candidateId of refutationOrder(state, player.id)) {
    const candidate = playerById(state, candidateId);
    const matches = matchingCards(candidate.hand, triple);
    if (matches.length === 0) continue;
    refuter = candidateId;
    if (options.chooseRefutationCard) {
      const chosen = options.chooseRefutationCard({ refuter: candidateId, options: matches });
      if (!matches.includes(chosen)) {
        throw new IllegalActionError(
          `${candidateId} cannot show ${String(chosen)}: not among ${matches.join(', ')}`,
        );
      }
      shown = chosen;
    } else {
      const [chosen, next] = pick(matches, rng);
      rng = next;
      shown = chosen;
    }
    break;
  }

  if (refuter !== null && shown !== null) {
    events.push({ type: 'suggestion-refuted', visibleTo: 'all', player: player.id, refuter });
    events.push({
      type: 'refutation-card-shown',
      visibleTo: [player.id, refuter],
      player: player.id,
      refuter,
      card: shown,
    });
  } else {
    events.push({ type: 'suggestion-unrefuted', visibleTo: 'all', player: player.id });
  }

  return {
    ...state,
    players,
    rng,
    suspectPositions: { ...state.suspectPositions, [triple.suspect]: { kind: 'room', room } },
    weaponPositions: { ...state.weaponPositions, [triple.weapon]: room },
    phase: 'awaiting-action',
    roll: null,
    events: append(state, ...events),
  };
}

/** What the last suggestion produced, or null if none has been made. */
export function lastSuggestionOutcome(state: GameState): SuggestionOutcome | null {
  let start = -1;
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    if ((state.events[index] as GameEvent).type === 'suggestion-made') {
      start = index;
      break;
    }
  }
  if (start < 0) return null;
  const made = state.events[start] as Extract<GameEvent, { type: 'suggestion-made' }>;
  let refuter: PlayerId | null = null;
  let card: Card | null = null;
  for (let index = start + 1; index < state.events.length; index += 1) {
    const event = state.events[index] as GameEvent;
    if (event.type === 'suggestion-made') break;
    if (event.type === 'suggestion-refuted') refuter = event.refuter;
    if (event.type === 'refutation-card-shown') card = event.card;
  }
  return {
    suggester: made.player,
    suspect: made.suspect,
    weapon: made.weapon,
    room: made.room,
    refuter,
    card,
  };
}

/**
 * Name a full triple and check it against the case file. Correct ends the game;
 * wrong bars the accuser from winning while leaving them in play to refute, and
 * ends their turn.
 */
export function makeAccusation(state: GameState, accusation: SolutionTriple): GameState {
  const player = assertActive(state);
  if (!isSuspect(accusation.suspect) || !isWeapon(accusation.weapon) || !isRoom(accusation.room)) {
    throw new IllegalActionError(`not a valid accusation: ${JSON.stringify(accusation)}`);
  }
  const correct =
    accusation.suspect === state.caseFile.suspect &&
    accusation.weapon === state.caseFile.weapon &&
    accusation.room === state.caseFile.room;

  const accused: GameEvent = {
    type: 'accusation-made',
    visibleTo: 'all',
    player: player.id,
    suspect: accusation.suspect,
    weapon: accusation.weapon,
    room: accusation.room,
    correct,
  };

  if (correct) {
    return {
      ...state,
      phase: 'game-over',
      roll: null,
      over: true,
      winner: player.id,
      events: append(state, accused, {
        type: 'game-over',
        visibleTo: 'all',
        winner: player.id,
        caseFile: state.caseFile,
      }),
    };
  }

  const eliminated: GameState = {
    ...state,
    players: withPlayer(state, player.id, { eliminated: true }),
    roll: null,
    events: append(state, accused, {
      type: 'player-eliminated',
      visibleTo: 'all',
      player: player.id,
    }),
  };
  return advanceTurn(eliminated);
}

/**
 * Hand play to the next player still in the running. `awaiting-move` may only
 * be abandoned when the roll leaves nowhere legal to go.
 */
export function endTurn(state: GameState): GameState {
  if (state.over) throw new IllegalActionError('the game is over');
  if (state.phase === 'awaiting-move' && legalMoves(state).length > 0) {
    throw new IllegalActionError('the rolled move must be made before ending the turn');
  }
  return advanceTurn(state);
}

function advanceTurn(state: GameState): GameState {
  const finished = currentPlayer(state);
  const players = withPlayer(state, finished.id, {
    hasMovedThisTurn: false,
    hasSuggestedThisTurn: false,
    movedBySuggestion: false,
  });
  const base: GameState = {
    ...state,
    players,
    roll: null,
    events: append(state, { type: 'turn-ended', visibleTo: 'all', player: finished.id }),
  };

  let nextIndex = -1;
  for (let step = 1; step <= players.length; step += 1) {
    const candidateIndex = (state.currentPlayerIndex + step) % players.length;
    if (!(players[candidateIndex] as Player).eliminated) {
      nextIndex = candidateIndex;
      break;
    }
  }

  if (nextIndex < 0) {
    // Everyone accused wrongly: the case file goes unsolved.
    return {
      ...base,
      phase: 'game-over',
      over: true,
      winner: null,
      events: append(base, {
        type: 'game-over',
        visibleTo: 'all',
        winner: null,
        caseFile: state.caseFile,
      }),
    };
  }

  const turnNumber = state.turnNumber + 1;
  return {
    ...base,
    currentPlayerIndex: nextIndex,
    phase: 'awaiting-roll',
    turnNumber,
    events: append(base, {
      type: 'turn-started',
      visibleTo: 'all',
      player: (players[nextIndex] as Player).id,
      turn: turnNumber,
    }),
  };
}
