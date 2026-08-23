import { describe, expect, test } from 'bun:test';
import {
  canSuggest,
  canTakeSecretPassage,
  currentPlayer,
  endTurn,
  getBoard,
  lastSuggestionOutcome,
  legalMoves,
  makeAccusation,
  makeSuggestion,
  matchingCards,
  moveTo,
  occupiedSquares,
  playerById,
  positionOf,
  provideRefutationCard,
  refutationOrder,
  rollDice,
  roomOf,
  takeSecretPassage,
} from '../../src/engine/actions.ts';
import { corridorAt, inRoom, legalDestinations, positionKey } from '../../src/engine/board.ts';
import { createGame } from '../../src/engine/setup.ts';
import type { Card } from '../../src/engine/cards.ts';
import { IllegalActionError, type GameState } from '../../src/engine/types.ts';
import {
  FIXTURE_CASE_FILE,
  arrangedGame,
  eventTypes,
  placeToken,
  standingInRoom,
  turnOf,
} from './helpers.ts';

describe('getBoard', () => {
  test('returns the same cached board every call', () => {
    expect(getBoard()).toBe(getBoard());
    expect(getBoard().squares.size).toBeGreaterThan(50);
  });
});

describe('player accessors', () => {
  const state = arrangedGame();

  test('currentPlayer is the seat whose turn it is', () => {
    expect(currentPlayer(state).id).toBe('p1');
    expect(currentPlayer(turnOf(state, 'p3')).id).toBe('p3');
  });

  test('playerById finds a seat and rejects an unknown id', () => {
    expect(playerById(state, 'p2').character).toBe('Colonel Mustard');
    expect(() => playerById(state, 'nobody')).toThrow(IllegalActionError);
  });

  test('positionOf reads the token of the seat, not the seat itself', () => {
    expect(positionOf(state, 'p1')).toEqual(state.suspectPositions['Miss Scarlett']);
    const moved = placeToken(state, 'p1', inRoom('Hall'));
    expect(positionOf(moved, 'p1')).toEqual(inRoom('Hall'));
  });

  test('roomOf is null in the corridor and named in a room', () => {
    expect(roomOf(state, 'p1')).toBeNull();
    expect(roomOf(placeToken(state, 'p1', inRoom('Hall')), 'p1')).toBe('Hall');
  });

  test('occupiedSquares lists corridor tokens and can exclude one suspect', () => {
    const all = occupiedSquares(state);
    expect(all.length).toBe(6);
    expect(occupiedSquares(state, 'Miss Scarlett').length).toBe(5);
    const withRoom = placeToken(state, 'p1', inRoom('Hall'));
    expect(occupiedSquares(withRoom).length).toBe(5);
  });
});

describe('rollDice', () => {
  test('produces a die in [1,6] and moves to awaiting-move', () => {
    const rolled = rollDice(arrangedGame());
    expect(rolled.roll).toBeGreaterThanOrEqual(1);
    expect(rolled.roll).toBeLessThanOrEqual(6);
    expect(rolled.phase).toBe('awaiting-move');
    expect(eventTypes(rolled).at(-1)).toBe('rolled');
  });

  test('is deterministic for a seed and advances the RNG', () => {
    const a = rollDice(createGame({ seed: 'dice-seed', playerCount: 3 }));
    const b = rollDice(createGame({ seed: 'dice-seed', playerCount: 3 }));
    expect(a.roll).toBe(b.roll);
    expect(a.rng.seed).not.toBe(createGame({ seed: 'dice-seed', playerCount: 3 }).rng.seed);
  });

  test('cannot be rolled twice in one turn', () => {
    expect(() => rollDice(rollDice(arrangedGame()))).toThrow(IllegalActionError);
  });

  test('cannot be rolled after the player has already moved', () => {
    const state = standingInRoom(arrangedGame(), 'p1', 'Library');
    expect(() => rollDice(state)).toThrow(IllegalActionError);
  });

  test('an eliminated player cannot roll', () => {
    const state = arrangedGame();
    const eliminated: GameState = {
      ...state,
      players: state.players.map((player) =>
        player.id === 'p1' ? { ...player, eliminated: true } : player,
      ),
    };
    expect(() => rollDice(eliminated)).toThrow(IllegalActionError);
  });
});

describe('legalMoves and moveTo', () => {
  test('legalMoves is empty until a die has been rolled', () => {
    expect(legalMoves(arrangedGame())).toEqual([]);
  });

  test('legalMoves matches the board, blocked by the other tokens', () => {
    const rolled = rollDice(arrangedGame());
    const expected = legalDestinations(
      getBoard(),
      rolled.suspectPositions['Miss Scarlett'],
      rolled.roll as number,
      occupiedSquares(rolled, 'Miss Scarlett'),
    );
    expect(legalMoves(rolled)).toEqual(expected);
    expect(legalMoves(rolled).length).toBeGreaterThan(0);
  });

  test('moveTo relocates the token, records the step cost, and opens the action phase', () => {
    const rolled = rollDice(arrangedGame());
    const target = legalMoves(rolled)[0];
    if (!target) throw new Error('expected at least one destination');
    const moved = moveTo(rolled, target.position);
    expect(positionOf(moved, 'p1')).toEqual(target.position);
    expect(moved.phase).toBe('awaiting-action');
    expect(moved.roll).toBeNull();
    expect(playerById(moved, 'p1').hasMovedThisTurn).toBe(true);
    const event = moved.events.at(-1);
    expect(event?.type).toBe('moved');
    expect(event).toMatchObject({ player: 'p1', steps: target.steps });
  });

  test('rejects a destination outside the roll', () => {
    const rolled = rollDice(arrangedGame());
    // The Kitchen is on the far side of the board from Miss Scarlett's start.
    expect(legalMoves(rolled).some((move) => positionKey(move.position) === 'room:Kitchen')).toBe(
      false,
    );
    expect(() => moveTo(rolled, inRoom('Kitchen'))).toThrow(IllegalActionError);
  });

  test('rejects moving before rolling', () => {
    expect(() => moveTo(arrangedGame(), corridorAt(6, 4))).toThrow(IllegalActionError);
  });

  test('a moved token no longer blocks its old square', () => {
    const rolled = rollDice(arrangedGame());
    const target = legalMoves(rolled)[0];
    if (!target) throw new Error('expected at least one destination');
    const moved = moveTo(rolled, target.position);
    const before = occupiedSquares(rolled).map((position) => positionKey(position));
    const after = occupiedSquares(moved).map((position) => positionKey(position));
    expect(before).toContain('corridor:16,4');
    if (target.position.kind === 'room') expect(after).not.toContain('corridor:16,4');
  });
});

describe('secret passages', () => {
  test('a player in a corner room may cross to the diagonal room without rolling', () => {
    const state = turnOf(placeToken(arrangedGame(), 'p1', inRoom('Study')), 'p1');
    expect(canTakeSecretPassage(state)).toBe(true);
    const crossed = takeSecretPassage(state);
    expect(positionOf(crossed, 'p1')).toEqual(inRoom('Kitchen'));
    expect(crossed.phase).toBe('awaiting-action');
    expect(playerById(crossed, 'p1').hasMovedThisTurn).toBe(true);
    expect(crossed.events.at(-1)).toMatchObject({
      type: 'secret-passage',
      from: 'Study',
      to: 'Kitchen',
    });
  });

  test('works from every corner room, both directions', () => {
    const pairs = [
      ['Study', 'Kitchen'],
      ['Kitchen', 'Study'],
      ['Conservatory', 'Lounge'],
      ['Lounge', 'Conservatory'],
    ] as const;
    for (const [from, to] of pairs) {
      const state = turnOf(placeToken(arrangedGame(), 'p1', inRoom(from)), 'p1');
      expect(positionOf(takeSecretPassage(state), 'p1')).toEqual(inRoom(to));
    }
  });

  test('is unavailable from a room without a passage, or from the corridor', () => {
    const inHall = turnOf(placeToken(arrangedGame(), 'p1', inRoom('Hall')), 'p1');
    expect(canTakeSecretPassage(inHall)).toBe(false);
    expect(() => takeSecretPassage(inHall)).toThrow(IllegalActionError);
    expect(canTakeSecretPassage(arrangedGame())).toBe(false);
  });

  test('is unavailable once the player has moved this turn', () => {
    const state = standingInRoom(arrangedGame(), 'p1', 'Study');
    expect(canTakeSecretPassage(state)).toBe(false);
    expect(() => takeSecretPassage(state)).toThrow(IllegalActionError);
  });
});

describe('refutationOrder and matchingCards', () => {
  const state = arrangedGame();

  test('order is clockwise from the suggester and excludes them', () => {
    expect(refutationOrder(state, 'p1')).toEqual(['p2', 'p3']);
    expect(refutationOrder(state, 'p2')).toEqual(['p3', 'p1']);
    expect(refutationOrder(state, 'p3')).toEqual(['p1', 'p2']);
  });

  test('rejects an unknown suggester', () => {
    expect(() => refutationOrder(state, 'ghost')).toThrow(IllegalActionError);
  });

  test('matchingCards returns the named cards a hand holds, in hand order', () => {
    const triple = { suspect: 'Colonel Mustard', weapon: 'Dagger', room: 'Library' } as const;
    expect(matchingCards(playerById(state, 'p2').hand, triple)).toEqual([
      'Colonel Mustard',
      'Dagger',
      'Library',
    ]);
    expect(matchingCards(playerById(state, 'p1').hand, triple)).toEqual([]);
  });
});

describe('makeSuggestion', () => {
  const inLibrary = () => standingInRoom(arrangedGame(), 'p1', 'Library');

  test('is only legal from inside a room', () => {
    const state = arrangedGame();
    expect(canSuggest(state)).toBe(false);
    expect(() => makeSuggestion(state, { suspect: 'Mrs. White', weapon: 'Rope' })).toThrow(
      IllegalActionError,
    );
  });

  test('names the room the suggester occupies, and relocates both named tokens there', () => {
    const suggested = makeSuggestion(inLibrary(), { suspect: 'Mrs. White', weapon: 'Rope' });
    expect(suggested.suspectPositions['Mrs. White']).toEqual(inRoom('Library'));
    expect(suggested.weaponPositions['Rope']).toBe('Library');
    expect(suggested.events.some((event) => event.type === 'suggestion-made')).toBe(true);
    expect(lastSuggestionOutcome(suggested)).toMatchObject({
      suggester: 'p1',
      suspect: 'Mrs. White',
      weapon: 'Rope',
      room: 'Library',
    });
  });

  test('the first clockwise holder refutes, not a later one', () => {
    // p2 holds Dagger and Library; p3 holds Mrs. White. p2 comes first.
    const suggested = makeSuggestion(inLibrary(), { suspect: 'Mrs. White', weapon: 'Dagger' });
    expect(suggested.pendingRefutation?.refuter).toBe('p2');
    const outcome = lastSuggestionOutcome(provideRefutationCard(suggested, 'Dagger'));
    expect(outcome?.refuter).toBe('p2');
    expect(outcome?.card).toBe('Dagger');
  });

  test('the shown card is private to the suggester and the refuter', () => {
    const suggested = provideRefutationCard(
      makeSuggestion(inLibrary(), { suspect: 'Mrs. White', weapon: 'Dagger' }),
      'Dagger',
    );
    const shown = suggested.events.find((event) => event.type === 'refutation-card-shown');
    expect(shown?.visibleTo).toEqual(['p1', 'p2']);
    const refuted = suggested.events.find((event) => event.type === 'suggestion-refuted');
    expect(refuted?.visibleTo).toBe('all');
  });

  test('a lone matching card settles the refutation inside the same action', () => {
    // p2's only card among {Mrs. Peacock, Candlestick, Library} is Library.
    const suggested = makeSuggestion(inLibrary(), { suspect: 'Mrs. Peacock', weapon: 'Candlestick' });
    expect(suggested.phase).toBe('awaiting-action');
    expect(suggested.pendingRefutation).toBeNull();
    expect(lastSuggestionOutcome(suggested)).toMatchObject({ refuter: 'p2', card: 'Library' });
  });

  test('"nobody could refute" is public and shows no card', () => {
    // Professor Plum and the Wrench are in the case file; p1 holds Dining Room.
    const state = standingInRoom(arrangedGame(), 'p1', 'Dining Room');
    const suggested = makeSuggestion(state, { suspect: 'Professor Plum', weapon: 'Wrench' });
    const outcome = lastSuggestionOutcome(suggested);
    expect(outcome?.refuter).toBeNull();
    expect(outcome?.card).toBeNull();
    const unrefuted = suggested.events.find((event) => event.type === 'suggestion-unrefuted');
    expect(unrefuted?.visibleTo).toBe('all');
    expect(suggested.events.some((event) => event.type === 'refutation-card-shown')).toBe(false);
  });

  test('an eliminated player still refutes', () => {
    const base = arrangedGame();
    const withEliminated: GameState = {
      ...base,
      players: base.players.map((player) =>
        player.id === 'p2' ? { ...player, eliminated: true } : player,
      ),
    };
    const state = standingInRoom(withEliminated, 'p1', 'Library');
    const suggested = makeSuggestion(state, { suspect: 'Mrs. White', weapon: 'Dagger' });
    expect(suggested.pendingRefutation?.refuter).toBe('p2');
    expect(lastSuggestionOutcome(provideRefutationCard(suggested, 'Library'))?.refuter).toBe('p2');
  });

  test('pulling another player into the room lets them suggest there next turn', () => {
    const suggested = provideRefutationCard(
      makeSuggestion(inLibrary(), { suspect: 'Colonel Mustard', weapon: 'Rope' }),
      'Library',
    );
    expect(playerById(suggested, 'p2').movedBySuggestion).toBe(true);
    expect(positionOf(suggested, 'p2')).toEqual(inRoom('Library'));

    const p2sTurn = turnOf(suggested, 'p2');
    expect(canSuggest(p2sTurn)).toBe(true);
    const second = makeSuggestion(p2sTurn, { suspect: 'Miss Scarlett', weapon: 'Candlestick' });
    expect(lastSuggestionOutcome(second)?.room).toBe('Library');
  });

  test('suggesting your own character does not flag you as moved by suggestion', () => {
    const suggested = makeSuggestion(inLibrary(), { suspect: 'Miss Scarlett', weapon: 'Rope' });
    expect(playerById(suggested, 'p1').movedBySuggestion).toBe(false);
    expect(positionOf(suggested, 'p1')).toEqual(inRoom('Library'));
  });

  test('only one suggestion per turn', () => {
    const once = makeSuggestion(inLibrary(), { suspect: 'Mrs. White', weapon: 'Rope' });
    expect(canSuggest(once)).toBe(false);
    expect(() => makeSuggestion(once, { suspect: 'Mrs. Peacock', weapon: 'Revolver' })).toThrow(
      IllegalActionError,
    );
  });

  test('rejects a card that is not a suspect or not a weapon', () => {
    expect(() =>
      makeSuggestion(inLibrary(), { suspect: 'Rope' as never, weapon: 'Rope' }),
    ).toThrow(IllegalActionError);
    expect(() =>
      makeSuggestion(inLibrary(), { suspect: 'Mrs. White', weapon: 'Library' as never }),
    ).toThrow(IllegalActionError);
  });

  test('an eliminated player cannot suggest', () => {
    const state = standingInRoom(arrangedGame(), 'p1', 'Library');
    const eliminated: GameState = {
      ...state,
      players: state.players.map((player) =>
        player.id === 'p1' ? { ...player, eliminated: true } : player,
      ),
    };
    expect(canSuggest(eliminated)).toBe(false);
    expect(() => makeSuggestion(eliminated, { suspect: 'Mrs. White', weapon: 'Rope' })).toThrow(
      IllegalActionError,
    );
  });
});

/**
 * The refutation choice is an ACTION, not a callback. Before, `makeSuggestion`
 * took a `chooseRefutationCard` callback and otherwise auto-picked with the
 * seeded RNG; that made the same state plus the same action produce different
 * outcomes depending on a function nobody could serialize, and put the choice
 * outside the action log the replay depends on.
 */
describe('provideRefutationCard', () => {
  const inLibrary = () => standingInRoom(arrangedGame(), 'p1', 'Library');
  // p2 holds all three of Colonel Mustard, Dagger and Library.
  const pending = () => makeSuggestion(inLibrary(), { suspect: 'Colonel Mustard', weapon: 'Dagger' });

  test('several matching cards park the game in awaiting-refutation, naming who chooses among what', () => {
    const state = pending();
    expect(state.phase).toBe('awaiting-refutation');
    expect(state.pendingRefutation).toEqual({
      suggester: 'p1',
      refuter: 'p2',
      triple: { suspect: 'Colonel Mustard', weapon: 'Dagger', room: 'Library' },
      options: ['Colonel Mustard', 'Dagger', 'Library'],
    });
    // Nothing is claimed about the refutation until the refuter has acted.
    expect(eventTypes(state)).not.toContain('suggestion-refuted');
    expect(eventTypes(state)).not.toContain('refutation-card-shown');
    expect(lastSuggestionOutcome(state)).toMatchObject({ refuter: null, card: null });
  });

  test('completes the refutation and returns the turn to awaiting-action', () => {
    const done = provideRefutationCard(pending(), 'Library');
    expect(done.phase).toBe('awaiting-action');
    expect(done.pendingRefutation).toBeNull();
    expect(lastSuggestionOutcome(done)).toMatchObject({ refuter: 'p2', card: 'Library' });
    expect(eventTypes(done).slice(-2)).toEqual(['suggestion-refuted', 'refutation-card-shown']);
  });

  test('keeps the visibility scoping: the card is private, the fact of it is public', () => {
    const done = provideRefutationCard(pending(), 'Colonel Mustard');
    const shown = done.events.find((event) => event.type === 'refutation-card-shown');
    expect(shown).toMatchObject({ player: 'p1', refuter: 'p2', card: 'Colonel Mustard' });
    expect(shown?.visibleTo).toEqual(['p1', 'p2']);
    expect(done.events.find((event) => event.type === 'suggestion-refuted')?.visibleTo).toBe('all');
  });

  test('the refuter may show any of their matching cards, and only those', () => {
    for (const card of ['Colonel Mustard', 'Dagger', 'Library'] as Card[]) {
      expect(lastSuggestionOutcome(provideRefutationCard(pending(), card))?.card).toBe(card);
    }
    // Rope is a real card, but not one p2 holds among the three named.
    expect(() => provideRefutationCard(pending(), 'Rope')).toThrow(IllegalActionError);
    // Billiard Room is p2's, but was not named in the suggestion.
    expect(() => provideRefutationCard(pending(), 'Billiard Room')).toThrow(IllegalActionError);
  });

  test('is illegal when no refutation is pending', () => {
    expect(() => provideRefutationCard(inLibrary(), 'Library')).toThrow(IllegalActionError);
    expect(() => provideRefutationCard(arrangedGame(), 'Library')).toThrow(IllegalActionError);
    const settled = provideRefutationCard(pending(), 'Library');
    expect(() => provideRefutationCard(settled, 'Dagger')).toThrow(IllegalActionError);
  });

  test('the rest of the turn is blocked until the refuter has chosen', () => {
    const state = pending();
    expect(() => endTurn(state)).toThrow(IllegalActionError);
    expect(() => makeAccusation(state, FIXTURE_CASE_FILE)).toThrow(IllegalActionError);
    expect(() => rollDice(state)).toThrow(IllegalActionError);
    expect(() => makeSuggestion(state, { suspect: 'Mrs. White', weapon: 'Rope' })).toThrow(
      IllegalActionError,
    );
    expect(canSuggest(state)).toBe(false);
    expect(canTakeSecretPassage(state)).toBe(false);
  });

  test('the choice never touches the RNG — determinism comes from the action log', () => {
    const before = inLibrary();
    const suggested = pending();
    expect(suggested.rng).toEqual(before.rng);
    expect(provideRefutationCard(suggested, 'Dagger').rng).toEqual(before.rng);
    // Same state, same action, same outcome — and a different card is only
    // reachable by logging a different action.
    expect(provideRefutationCard(pending(), 'Dagger')).toEqual(
      provideRefutationCard(pending(), 'Dagger'),
    );
    expect(lastSuggestionOutcome(provideRefutationCard(pending(), 'Dagger'))?.card).not.toBe(
      lastSuggestionOutcome(provideRefutationCard(pending(), 'Library'))?.card,
    );
  });
});

describe('lastSuggestionOutcome', () => {
  test('is null before any suggestion and tracks the most recent one', () => {
    expect(lastSuggestionOutcome(arrangedGame())).toBeNull();
    const first = makeSuggestion(standingInRoom(arrangedGame(), 'p1', 'Library'), {
      suspect: 'Mrs. White',
      weapon: 'Rope',
    });
    const second = makeSuggestion(standingInRoom(first, 'p3', 'Hall'), {
      suspect: 'Mrs. Peacock',
      weapon: 'Revolver',
    });
    expect(lastSuggestionOutcome(second)).toMatchObject({ suggester: 'p3', room: 'Hall' });
  });
});

describe('makeAccusation', () => {
  test('a correct accusation wins and reveals the case file', () => {
    const won = makeAccusation(arrangedGame(), FIXTURE_CASE_FILE);
    expect(won.over).toBe(true);
    expect(won.winner).toBe('p1');
    expect(won.phase).toBe('game-over');
    expect(won.events.at(-1)).toMatchObject({ type: 'game-over', winner: 'p1' });
    expect(won.events.at(-2)).toMatchObject({ type: 'accusation-made', correct: true });
  });

  test('does not require standing in the accused room', () => {
    const state = placeToken(arrangedGame(), 'p1', inRoom('Ballroom'));
    expect(makeAccusation(state, FIXTURE_CASE_FILE).winner).toBe('p1');
  });

  test('a wrong accusation eliminates the accuser and passes the turn', () => {
    const wrong = makeAccusation(arrangedGame(), {
      suspect: 'Mrs. White',
      weapon: 'Rope',
      room: 'Hall',
    });
    expect(wrong.over).toBe(false);
    expect(wrong.winner).toBeNull();
    expect(playerById(wrong, 'p1').eliminated).toBe(true);
    expect(currentPlayer(wrong).id).toBe('p2');
    expect(eventTypes(wrong)).toContain('player-eliminated');
  });

  test('an eliminated player is skipped on later turns but still refutes', () => {
    const wrong = makeAccusation(arrangedGame(), {
      suspect: 'Mrs. White',
      weapon: 'Rope',
      room: 'Hall',
    });
    // p2 -> p3 -> back to p2, never p1. Each seat takes a real turn first:
    // endTurn no longer accepts a seat that has not moved.
    const afterP2 = endTurn(standingInRoom(wrong, 'p2', 'Lounge'));
    expect(currentPlayer(afterP2).id).toBe('p3');
    const afterP3 = endTurn(standingInRoom(afterP2, 'p3', 'Kitchen'));
    expect(currentPlayer(afterP3).id).toBe('p2');

    const suggestion = makeSuggestion(standingInRoom(afterP3, 'p2', 'Ballroom'), {
      suspect: 'Miss Scarlett',
      weapon: 'Candlestick',
    });
    expect(suggestion.pendingRefutation?.refuter).toBe('p1');
    expect(lastSuggestionOutcome(provideRefutationCard(suggestion, 'Ballroom'))?.refuter).toBe('p1');
  });

  test('an eliminated player cannot accuse again', () => {
    const wrong = makeAccusation(arrangedGame(), {
      suspect: 'Mrs. White',
      weapon: 'Rope',
      room: 'Hall',
    });
    expect(() => makeAccusation(turnOf(wrong, 'p1'), FIXTURE_CASE_FILE)).toThrow(IllegalActionError);
  });

  test('when everyone has accused wrongly the game ends unsolved', () => {
    const wrongTriple = { suspect: 'Mrs. White', weapon: 'Rope', room: 'Hall' } as const;
    let state = arrangedGame();
    state = makeAccusation(state, wrongTriple);
    state = makeAccusation(state, wrongTriple);
    expect(state.over).toBe(false);
    state = makeAccusation(state, wrongTriple);
    expect(state.over).toBe(true);
    expect(state.winner).toBeNull();
    expect(state.events.at(-1)).toMatchObject({ type: 'game-over', winner: null });
  });

  test('rejects a malformed triple and any action after the game is over', () => {
    expect(() =>
      makeAccusation(arrangedGame(), { suspect: 'Rope', weapon: 'Rope', room: 'Study' } as never),
    ).toThrow(IllegalActionError);
    const won = makeAccusation(arrangedGame(), FIXTURE_CASE_FILE);
    expect(() => makeAccusation(won, FIXTURE_CASE_FILE)).toThrow(IllegalActionError);
    expect(() => rollDice(won)).toThrow(IllegalActionError);
    expect(() => endTurn(won)).toThrow(IllegalActionError);
  });
});

describe('endTurn', () => {
  test('passes play clockwise, bumps the turn number and clears per-turn flags', () => {
    const acted = standingInRoom(arrangedGame(), 'p1', 'Library');
    const ended = endTurn(acted);
    expect(currentPlayer(ended).id).toBe('p2');
    expect(ended.turnNumber).toBe(acted.turnNumber + 1);
    expect(ended.phase).toBe('awaiting-roll');
    expect(ended.roll).toBeNull();
    expect(playerById(ended, 'p1').hasMovedThisTurn).toBe(false);
    expect(playerById(ended, 'p1').hasSuggestedThisTurn).toBe(false);
    expect(eventTypes(ended).slice(-2)).toEqual(['turn-ended', 'turn-started']);
  });

  test('wraps from the last seat back to the first', () => {
    const state = standingInRoom(arrangedGame(), 'p3', 'Hall');
    expect(currentPlayer(endTurn(state)).id).toBe('p1');
  });

  // Corrected semantics: the OLD assertion here let a player end their turn
  // straight from awaiting-roll, i.e. skip the mandatory roll+move. Standard
  // Clue: you must roll and move on your turn (the secret passage is the
  // alternative to rolling), so awaiting-roll now refuses.
  test('refuses to skip the mandatory roll and move', () => {
    const fresh = turnOf(arrangedGame(), 'p3');
    expect(fresh.phase).toBe('awaiting-roll');
    expect(playerById(fresh, 'p3').hasMovedThisTurn).toBe(false);
    expect(() => endTurn(fresh)).toThrow(IllegalActionError);
  });

  test('is legal once the roll has been spent on a move', () => {
    const rolled = rollDice(turnOf(arrangedGame(), 'p3'));
    const target = legalMoves(rolled)[0];
    if (!target) throw new Error('expected at least one destination');
    expect(currentPlayer(endTurn(moveTo(rolled, target.position))).id).toBe('p1');
  });

  test('is legal after a secret passage, which replaces the roll', () => {
    const state = turnOf(placeToken(arrangedGame(), 'p1', inRoom('Study')), 'p1');
    expect(currentPlayer(endTurn(takeSecretPassage(state))).id).toBe('p2');
  });

  test('a player pulled into a room may suggest there and then end without moving', () => {
    const pulled = makeSuggestion(standingInRoom(arrangedGame(), 'p1', 'Library'), {
      suspect: 'Colonel Mustard',
      weapon: 'Rope',
    });
    const p2sTurn = turnOf(pulled, 'p2');
    expect(() => endTurn(p2sTurn)).toThrow(IllegalActionError);
    // p3 holds Mrs. Peacock and nothing else named, so the refutation settles
    // inside makeSuggestion and the turn is squarely in awaiting-action.
    const suggested = makeSuggestion(p2sTurn, {
      suspect: 'Mrs. Peacock',
      weapon: 'Candlestick',
    });
    expect(playerById(suggested, 'p2').hasMovedThisTurn).toBe(false);
    expect(currentPlayer(endTurn(suggested)).id).toBe('p3');
  });

  test('an eliminated seat whose turn is forced on it may pass', () => {
    // advanceTurn skips eliminated seats, so this is only reachable by force.
    // It must not deadlock: an eliminated player owes no roll.
    const wrong = makeAccusation(arrangedGame(), {
      suspect: 'Mrs. White',
      weapon: 'Rope',
      room: 'Hall',
    });
    const forced = turnOf(wrong, 'p1');
    expect(playerById(forced, 'p1').eliminated).toBe(true);
    expect(currentPlayer(endTurn(forced)).id).toBe('p2');
  });

  test('refuses to skip a move that is still available', () => {
    const rolled = rollDice(arrangedGame());
    expect(legalMoves(rolled).length).toBeGreaterThan(0);
    expect(() => endTurn(rolled)).toThrow(IllegalActionError);
  });

  test('allows ending the turn when the roll leaves nowhere legal to go', () => {
    // p1 is in the Study; p2's token blocks its only door.
    let state = arrangedGame();
    state = placeToken(state, 'p1', inRoom('Study'));
    state = placeToken(state, 'p2', corridorAt(6, 4));
    const rolled = rollDice(turnOf(state, 'p1'));
    expect(legalMoves(rolled)).toEqual([]);
    expect(currentPlayer(endTurn(rolled)).id).toBe('p2');
  });
});
