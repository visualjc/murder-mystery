import { describe, expect, test } from 'bun:test';
import {
  describeEvent,
  describeLog,
  describePosition,
  handOf,
  knownCards,
  playerView,
  publicEvents,
  visibleEvents,
} from '../../src/engine/view.ts';
import {
  lastSuggestionOutcome,
  makeAccusation,
  makeSuggestion,
  provideRefutationCard,
} from '../../src/engine/actions.ts';
import { corridorAt, inRoom } from '../../src/engine/board.ts';
import type { Card } from '../../src/engine/cards.ts';
import { IllegalActionError } from '../../src/engine/types.ts';
import { FIXTURE_CASE_FILE, arrangedGame, standingInRoom } from './helpers.ts';

/**
 * p1 suggests from the Library and p2 — who holds both Dagger and Library —
 * shows the Dagger. The refutation is two actions because the choice belongs to
 * the refuter, not to the engine.
 */
const suggested = () =>
  provideRefutationCard(
    makeSuggestion(standingInRoom(arrangedGame(), 'p1', 'Library'), {
      suspect: 'Mrs. White',
      weapon: 'Dagger',
    }),
    'Dagger',
  );

describe('visibleEvents and publicEvents', () => {
  test('the suggester and the refuter see the shown card; the third player does not', () => {
    const state = suggested();
    const shownFor = (playerId: string) =>
      visibleEvents(state, playerId).filter((event) => event.type === 'refutation-card-shown');
    expect(shownFor('p1').length).toBe(1);
    expect(shownFor('p2').length).toBe(1);
    expect(shownFor('p3').length).toBe(0);
  });

  test('everyone still learns THAT a refutation happened and by whom', () => {
    const state = suggested();
    for (const playerId of ['p1', 'p2', 'p3']) {
      expect(
        visibleEvents(state, playerId).some(
          (event) => event.type === 'suggestion-refuted' && event.refuter === 'p2',
        ),
      ).toBe(true);
    }
  });

  test('publicEvents never contains a private event', () => {
    const state = suggested();
    expect(publicEvents(state).some((event) => event.type === 'refutation-card-shown')).toBe(false);
    expect(publicEvents(state).every((event) => event.visibleTo === 'all')).toBe(true);
    expect(publicEvents(state).length).toBeLessThan(state.events.length);
  });

  test('an unknown player simply sees the public log', () => {
    const state = suggested();
    expect(visibleEvents(state, 'spectator')).toEqual(publicEvents(state));
  });
});

describe('handOf', () => {
  test('returns the seat’s cards and rejects an unknown seat', () => {
    const state = arrangedGame();
    expect(handOf(state, 'p2')).toContain('Dagger');
    expect(() => handOf(state, 'nobody')).toThrow(IllegalActionError);
  });
});

describe('playerView', () => {
  test('never carries the case file, at any depth', () => {
    const view = playerView(arrangedGame(), 'p1');
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(walk);
      } else if (value && typeof value === 'object') {
        for (const [key, nested] of Object.entries(value)) {
          keys.add(key);
          walk(nested);
        }
      }
    };
    walk(view);
    expect([...keys].filter((key) => key.toLowerCase().includes('casefile'))).toEqual([]);
  });

  test('never carries another player’s hand — only its size', () => {
    const state = arrangedGame();
    const view = playerView(state, 'p1');
    expect(view.hand).toEqual(state.players[0]?.hand as never);
    expect(view.opponents.map((opponent) => opponent.handSize)).toEqual([6, 6]);
    const serialized = JSON.stringify(view.opponents);
    expect(serialized).not.toContain('Dagger');
    expect(serialized).not.toContain('Revolver');
  });

  test('reports whose turn it is and the phase', () => {
    const state = arrangedGame();
    expect(playerView(state, 'p1')).toMatchObject({
      you: 'p1',
      character: 'Miss Scarlett',
      currentPlayer: 'p1',
      yourTurn: true,
      phase: 'awaiting-roll',
      turnNumber: 1,
      over: false,
      winner: null,
    });
    expect(playerView(state, 'p2').yourTurn).toBe(false);
  });

  test('exposes public token positions for every suspect and weapon', () => {
    const view = playerView(suggested(), 'p3');
    expect(view.suspectPositions['Mrs. White']).toEqual(inRoom('Library'));
    expect(view.weaponPositions['Dagger']).toBe('Library');
    expect(Object.keys(view.weaponPositions).length).toBe(6);
  });

  test('carries only the events that player may see', () => {
    const state = suggested();
    expect(playerView(state, 'p3').events).toEqual(visibleEvents(state, 'p3'));
    expect(playerView(state, 'p1').events.length).toBeGreaterThan(
      playerView(state, 'p3').events.length,
    );
  });

  test('a pending refutation names the chooser publicly but the cards privately', () => {
    // p2 holds all three of Colonel Mustard, Dagger and Library, so the choice
    // is theirs and the options are part of their hand.
    const pending = makeSuggestion(standingInRoom(arrangedGame(), 'p1', 'Library'), {
      suspect: 'Colonel Mustard',
      weapon: 'Dagger',
    });
    expect(playerView(pending, 'p2').pendingRefutation).toEqual({
      suggester: 'p1',
      refuter: 'p2',
      yours: true,
      options: ['Colonel Mustard', 'Dagger', 'Library'],
    });
    for (const seat of ['p1', 'p3']) {
      expect(playerView(pending, seat).pendingRefutation).toEqual({
        suggester: 'p1',
        refuter: 'p2',
        yours: false,
        options: null,
      });
      expect(JSON.stringify(playerView(pending, seat).pendingRefutation)).not.toContain('Dagger');
    }
    expect(playerView(suggested(), 'p1').pendingRefutation).toBeNull();
  });

  test('reports the winner once the game is over', () => {
    const won = makeAccusation(arrangedGame(), FIXTURE_CASE_FILE);
    expect(playerView(won, 'p2')).toMatchObject({ over: true, winner: 'p1', yourTurn: false });
  });

  test('rejects an unknown player', () => {
    expect(() => playerView(arrangedGame(), 'nobody')).toThrow(IllegalActionError);
  });
});

describe('describePosition and describeEvent', () => {
  test('describes rooms and corridor squares', () => {
    expect(describePosition(inRoom('Ballroom'))).toBe('the Ballroom');
    expect(describePosition(corridorAt(6, 7))).toBe('corridor 6,7');
  });

  test('produces a non-empty sentence for every event type the engine emits', () => {
    const state = makeAccusation(suggested(), FIXTURE_CASE_FILE);
    const seen = new Set(state.events.map((event) => event.type));
    expect(seen.size).toBeGreaterThanOrEqual(7);
    for (const event of state.events) {
      const sentence = describeEvent(event);
      expect(typeof sentence).toBe('string');
      expect(sentence.length).toBeGreaterThan(0);
      expect(sentence.trim()).toBe(sentence);
    }
  });

  test('the public refutation sentence does not name the card', () => {
    const state = suggested();
    const refuted = state.events.find((event) => event.type === 'suggestion-refuted');
    if (!refuted) throw new Error('expected a refutation');
    const card = lastSuggestionOutcome(state)?.card as string;
    expect(describeEvent(refuted)).not.toContain(card);
  });

  test('the private sentence does name the card', () => {
    const state = suggested();
    const shown = state.events.find((event) => event.type === 'refutation-card-shown');
    if (!shown) throw new Error('expected a shown card');
    expect(describeEvent(shown)).toContain(lastSuggestionOutcome(state)?.card as string);
  });

  test('a wrong accusation reads as wrong; the game-over line reveals the answer', () => {
    const wrong = makeAccusation(arrangedGame(), {
      suspect: 'Mrs. White',
      weapon: 'Rope',
      room: 'Hall',
    });
    const accusation = wrong.events.find((event) => event.type === 'accusation-made');
    expect(describeEvent(accusation as never)).toContain('is wrong');

    const won = makeAccusation(arrangedGame(), FIXTURE_CASE_FILE);
    expect(describeEvent(won.events.at(-1) as never)).toContain('Professor Plum');
  });
});

describe('describeLog', () => {
  test('renders one sentence per visible event, in order', () => {
    const state = suggested();
    expect(describeLog(state, 'p3').length).toBe(visibleEvents(state, 'p3').length);
    expect(describeLog(state, 'p1').length).toBeGreaterThan(describeLog(state, 'p3').length);
    expect(describeLog(state, 'p1')[0]).toContain('The game begins');
  });
});

describe('knownCards', () => {
  test('starts as exactly the player’s own hand', () => {
    const state = arrangedGame();
    const known = knownCards(state, 'p1');
    const ownHand = [...(state.players[0]?.hand ?? [])].sort();
    expect([...known.keys()].sort()).toEqual(ownHand);
    expect([...known.values()].every((holder) => holder === 'p1')).toBe(true);
  });

  test('grows by the cards a player has been shown, attributed to the refuter', () => {
    const state = suggested();
    const card = lastSuggestionOutcome(state)?.card as Card;
    expect(knownCards(state, 'p1').get(card)).toBe('p2');
    expect(knownCards(state, 'p3').has(card)).toBe(false);
  });

  test('never attributes a card the player has not been shown', () => {
    const state = suggested();
    expect(knownCards(state, 'p3').size).toBe(6);
  });
});
