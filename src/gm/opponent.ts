/**
 * The opponent policy: the "simple game master" that plays the suspects the
 * human is not playing.
 *
 * Legality is entirely deterministic and entirely view-driven. `planOpponentAction`
 * reads a `PlayerView` — the seat's own hand, the public board, the events
 * addressed to it — and returns a PLAN; `applyOpponentPlan` hands that plan to
 * the real engine action, which is the only thing that decides whether it was
 * legal. Nothing here samples, calls the network, or reads `GameState.caseFile`.
 * The LLM's contribution to an opponent's turn is voice, applied afterwards by
 * the narrator to the events the turn produced (ADR-0001: the model may
 * describe what happened, never decide it).
 *
 * The policy in one paragraph: settle a refutation we owe; accuse the moment
 * the notebook leaves exactly one triple; otherwise walk toward the nearest
 * room we have not yet stood in that is still a candidate answer, and once in a
 * room suggest the least-tested suspect and weapon our notebook still allows.
 */

import {
  ROOMS,
  SUSPECTS,
  WEAPONS,
  type Card,
  type Room,
  type SolutionTriple,
  type Suspect,
  type Weapon,
} from '../engine/cards.ts';
import {
  legalDestinations,
  secretPassageFrom,
  type Destination,
  type Position,
} from '../engine/board.ts';
import {
  currentPlayer,
  endTurn,
  getBoard,
  makeAccusation,
  makeSuggestion,
  moveTo,
  provideRefutationCard,
  rollDice,
  takeSecretPassage,
} from '../engine/actions.ts';
import { IllegalActionError, type GameState } from '../engine/types.ts';
import { playerView, type PlayerView } from '../engine/view.ts';
import { buildNotebook, type Notebook } from './notebook.ts';

export type OpponentPlan =
  | { readonly kind: 'refute'; readonly card: Card }
  | { readonly kind: 'accuse'; readonly triple: SolutionTriple }
  | { readonly kind: 'secret-passage' }
  | { readonly kind: 'roll' }
  | { readonly kind: 'move'; readonly position: Position; readonly steps: number }
  | { readonly kind: 'suggest'; readonly suspect: Suspect; readonly weapon: Weapon }
  | { readonly kind: 'end-turn' };

/** Wide enough to cross the whole board; used to measure distances, never to move. */
const BOARD_DIAMETER = 99;

/** Corridor squares held by tokens other than this seat's — they block movement. */
function blockedFor(view: PlayerView): Position[] {
  const blocked: Position[] = [];
  for (const [suspect, position] of Object.entries(view.suspectPositions)) {
    if (suspect === view.character) continue;
    if (position.kind === 'corridor') blocked.push(position);
  }
  return blocked;
}

/** Rooms this seat has already stood in, including the one it stands in now. */
function visitedRooms(view: PlayerView): Set<Room> {
  const visited = new Set<Room>();
  for (const event of view.events) {
    if (event.type === 'moved' && event.player === view.you && event.to.kind === 'room') {
      visited.add(event.to.room);
    }
    if (event.type === 'secret-passage' && event.player === view.you) visited.add(event.to);
    if (event.type === 'token-relocated' && event.token === view.character) visited.add(event.to);
  }
  if (view.position.kind === 'room') visited.add(view.position.room);
  return visited;
}

/** True when this seat has already suggested since its current turn began. */
function suggestedThisTurn(view: PlayerView): boolean {
  let turnStart = -1;
  for (let index = view.events.length - 1; index >= 0; index -= 1) {
    const event = view.events[index];
    if (event !== undefined && event.type === 'turn-started' && event.player === view.you) {
      turnStart = index;
      break;
    }
  }
  for (let index = turnStart + 1; index < view.events.length; index += 1) {
    const event = view.events[index];
    if (event !== undefined && event.type === 'suggestion-made' && event.player === view.you) {
      return true;
    }
  }
  return false;
}

/** Distance in steps from `from` to every room the mover can reach. */
function roomDistances(from: Position, blocked: readonly Position[]): Map<Room, number> {
  const distances = new Map<Room, number>();
  for (const destination of legalDestinations(getBoard(), from, BOARD_DIAMETER, blocked)) {
    if (destination.position.kind === 'room') {
      distances.set(destination.position.room, destination.steps);
    }
  }
  return distances;
}

/**
 * How badly this seat wants to be in a given room: 0 is best.
 * An unvisited room that is still a candidate answer is worth most, because
 * standing in it is the only way to ask about it.
 */
function roomPriority(room: Room, notebook: Notebook, visited: ReadonlySet<Room>): number {
  const candidate = notebook.rooms.includes(room);
  if (candidate && !visited.has(room)) return 0;
  if (candidate) return 1;
  if (!visited.has(room)) return 2;
  return 3;
}

/** The room this seat is heading for, or null when the board offers none. */
function targetRoom(view: PlayerView, notebook: Notebook): Room | null {
  const visited = visitedRooms(view);
  const distances = roomDistances(view.position, blockedFor(view));
  let best: Room | null = null;
  let bestScore: [number, number, number] | null = null;
  ROOMS.forEach((room, index) => {
    const distance = distances.get(room);
    if (distance === undefined) return;
    const score: [number, number, number] = [roomPriority(room, notebook, visited), distance, index];
    if (bestScore === null || compareScores(score, bestScore) < 0) {
      best = room;
      bestScore = score;
    }
  });
  return best;
}

function compareScores(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left - right;
  }
  return 0;
}

/**
 * Where to finish this move: the target room if it is reachable now, otherwise
 * the legal destination that leaves the shortest walk to it.
 */
function chooseDestination(view: PlayerView, notebook: Notebook): Destination | null {
  const blocked = blockedFor(view);
  const moves = legalDestinations(getBoard(), view.position, view.roll ?? 0, blocked);
  if (moves.length === 0) return null;

  const target = targetRoom(view, notebook);
  if (target === null) return moves[0] ?? null;

  let best: Destination | null = null;
  let bestScore: [number, number, number] | null = null;
  for (const move of moves) {
    const remaining =
      move.position.kind === 'room' && move.position.room === target
        ? 0
        : roomDistances(move.position, blocked).get(target) ?? Number.MAX_SAFE_INTEGER;
    // Prefer the shortest walk left; break ties toward actually being in a room
    // this turn, then by a stable key so the choice never wobbles.
    const score: [number, number, number] = [
      remaining,
      move.position.kind === 'room' ? 0 : 1,
      0,
    ];
    if (bestScore === null || compareScores(score, bestScore) < 0) {
      best = move;
      bestScore = score;
    }
  }
  return best;
}

/** How many times this seat has already named each card in its own suggestions. */
function timesNamed(view: PlayerView): Map<Card, number> {
  const counts = new Map<Card, number>();
  for (const event of view.events) {
    if (event.type !== 'suggestion-made' || event.player !== view.you) continue;
    for (const card of [event.suspect, event.weapon] as Card[]) {
      counts.set(card, (counts.get(card) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * The least-tested card the notebook has not yet eliminated: every suggestion
 * should ask something this seat does not already know the answer to.
 */
function leastTested<T extends Card>(
  candidates: readonly T[],
  all: readonly T[],
  counts: ReadonlyMap<Card, number>,
): T {
  const pool = candidates.length > 0 ? candidates : all;
  let best = pool[0] as T;
  let bestScore: [number, number] = [counts.get(best) ?? 0, all.indexOf(best)];
  for (const card of pool) {
    const score: [number, number] = [counts.get(card) ?? 0, all.indexOf(card)];
    if (compareScores(score, bestScore) < 0) {
      best = card;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The next thing this seat should do, from what it is entitled to know.
 *
 * Throws when it is neither this seat's turn nor its refutation to settle —
 * the caller has asked the wrong seat.
 */
export function planOpponentAction(view: PlayerView): OpponentPlan {
  if (view.pendingRefutation?.yours === true) {
    const card = view.pendingRefutation.options?.[0];
    if (card === undefined) throw new IllegalActionError('a pending refutation must offer a card');
    return { kind: 'refute', card };
  }
  if (view.over) throw new IllegalActionError('the game is over');
  if (!view.yourTurn) throw new IllegalActionError(`it is not ${view.you}'s turn`);
  if (view.phase === 'awaiting-refutation') {
    throw new IllegalActionError('a refutation is pending on another seat');
  }
  // An eliminated seat may only refute; if play ever reaches it, it passes.
  if (view.eliminated) return { kind: 'end-turn' };

  const notebook = buildNotebook(view);
  if (notebook.solution !== null) return { kind: 'accuse', triple: notebook.solution };

  switch (view.phase) {
    case 'awaiting-roll': {
      // A secret passage is a free crossing — worth taking when it lands us
      // somewhere we still need to ask about.
      if (view.position.kind === 'room') {
        const through = secretPassageFrom(view.position.room);
        if (
          through !== null &&
          notebook.rooms.includes(through) &&
          !visitedRooms(view).has(through)
        ) {
          return { kind: 'secret-passage' };
        }
      }
      return { kind: 'roll' };
    }
    case 'awaiting-move': {
      const destination = chooseDestination(view, notebook);
      if (destination === null) return { kind: 'end-turn' };
      return { kind: 'move', position: destination.position, steps: destination.steps };
    }
    case 'awaiting-action': {
      if (view.position.kind !== 'room' || suggestedThisTurn(view)) return { kind: 'end-turn' };
      const counts = timesNamed(view);
      return {
        kind: 'suggest',
        suspect: leastTested(notebook.suspects, SUSPECTS, counts) as Suspect,
        weapon: leastTested(notebook.weapons, WEAPONS, counts) as Weapon,
      };
    }
    default:
      throw new IllegalActionError(`no plan for phase ${view.phase}`);
  }
}

/** Hand a plan to the engine, which is the only judge of whether it was legal. */
export function applyOpponentPlan(state: GameState, plan: OpponentPlan): GameState {
  switch (plan.kind) {
    case 'refute':
      return provideRefutationCard(state, plan.card);
    case 'accuse':
      return makeAccusation(state, plan.triple);
    case 'secret-passage':
      return takeSecretPassage(state);
    case 'roll':
      return rollDice(state);
    case 'move':
      return moveTo(state, plan.position);
    case 'suggest':
      return makeSuggestion(state, { suspect: plan.suspect, weapon: plan.weapon });
    case 'end-turn':
      return endTurn(state);
  }
}

/** The seat that owes a refutation shows a card. Throws when none is pending. */
export function refuteAsOpponent(state: GameState): GameState {
  const pending = state.pendingRefutation;
  if (pending === null) throw new IllegalActionError('no refutation is pending');
  const view = playerView(state, pending.refuter);
  return applyOpponentPlan(state, planOpponentAction(view));
}

/**
 * Play the current seat's whole turn.
 *
 * Returns as soon as the turn is over, the game ends, or a refutation is owed
 * by another seat — that choice belongs to whoever holds those cards, human or
 * policy, and the caller decides which.
 */
export function playOpponentTurn(state: GameState, maxActions = 16): GameState {
  if (state.over) return state;
  const seat = currentPlayer(state).id;
  let next = state;
  for (let action = 0; action < maxActions; action += 1) {
    if (next.over || next.phase === 'awaiting-refutation') return next;
    if (next.turnNumber !== state.turnNumber || currentPlayer(next).id !== seat) return next;
    next = applyOpponentPlan(next, planOpponentAction(playerView(next, seat)));
  }
  throw new IllegalActionError(`${seat}'s turn did not finish within ${maxActions} actions`);
}
