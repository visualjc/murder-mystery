import { describe, expect, test } from 'bun:test';
import {
  ROOMS,
  SUSPECTS,
  WEAPONS,
  cardCategory,
  fullDeck,
  isCard,
  isRoom,
  isSuspect,
  isWeapon,
  sameTriple,
  tripleToCards,
} from '../../src/engine/cards.ts';

describe('deck composition', () => {
  test('is 6 suspects, 6 weapons and 9 rooms', () => {
    expect(SUSPECTS.length).toBe(6);
    expect(WEAPONS.length).toBe(6);
    expect(ROOMS.length).toBe(9);
  });

  test('fullDeck is exactly 21 distinct cards', () => {
    const deck = fullDeck();
    expect(deck.length).toBe(21);
    expect(new Set(deck).size).toBe(21);
  });

  test('no name is shared across categories', () => {
    const all = [...SUSPECTS, ...WEAPONS, ...ROOMS];
    expect(new Set(all).size).toBe(all.length);
  });

  test('the four corner rooms of the classic board are present', () => {
    for (const room of ['Study', 'Kitchen', 'Conservatory', 'Lounge']) {
      expect(ROOMS).toContain(room as never);
    }
  });
});

describe('type guards', () => {
  test('recognise their own category and reject the others', () => {
    expect(isSuspect('Professor Plum')).toBe(true);
    expect(isSuspect('Rope')).toBe(false);
    expect(isWeapon('Rope')).toBe(true);
    expect(isWeapon('Study')).toBe(false);
    expect(isRoom('Study')).toBe(true);
    expect(isRoom('Professor Plum')).toBe(false);
  });

  test('reject non-strings and unknown names', () => {
    for (const value of [null, undefined, 42, {}, [], 'The Wine Cellar']) {
      expect(isCard(value)).toBe(false);
    }
  });

  test('isCard accepts every card in the deck', () => {
    expect(fullDeck().every(isCard)).toBe(true);
  });
});

describe('cardCategory', () => {
  test('classifies one card of each category', () => {
    expect(cardCategory('Miss Scarlett')).toBe('suspect');
    expect(cardCategory('Candlestick')).toBe('weapon');
    expect(cardCategory('Ballroom')).toBe('room');
  });

  test('classifies every card in the deck, with the expected counts', () => {
    const counts = { suspect: 0, weapon: 0, room: 0 };
    for (const card of fullDeck()) counts[cardCategory(card)] += 1;
    expect(counts).toEqual({ suspect: 6, weapon: 6, room: 9 });
  });

  test('throws for a non-card', () => {
    expect(() => cardCategory('Wine Cellar' as never)).toThrow(TypeError);
  });
});

describe('solution triples', () => {
  const triple = { suspect: 'Mrs. Peacock', weapon: 'Wrench', room: 'Hall' } as const;

  test('tripleToCards lists suspect, weapon then room', () => {
    expect(tripleToCards(triple)).toEqual(['Mrs. Peacock', 'Wrench', 'Hall']);
  });

  test('sameTriple compares by value, not identity', () => {
    expect(sameTriple(triple, { ...triple })).toBe(true);
    expect(sameTriple(triple, { ...triple, room: 'Study' })).toBe(false);
    expect(sameTriple(triple, { ...triple, weapon: 'Rope' })).toBe(false);
    expect(sameTriple(triple, { ...triple, suspect: 'Professor Plum' })).toBe(false);
  });
});
