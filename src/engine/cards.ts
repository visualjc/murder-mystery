/**
 * The deck: 6 suspects, 6 weapons, 9 rooms — 21 cards.
 *
 * Card identity is the card's name. A card belongs to exactly one category,
 * and at any moment lives either in the case file or in exactly one hand.
 */

export const SUSPECTS = [
  'Miss Scarlett',
  'Colonel Mustard',
  'Mrs. White',
  'Reverend Green',
  'Mrs. Peacock',
  'Professor Plum',
] as const;

export const WEAPONS = [
  'Candlestick',
  'Dagger',
  'Lead Pipe',
  'Revolver',
  'Rope',
  'Wrench',
] as const;

export const ROOMS = [
  'Kitchen',
  'Ballroom',
  'Conservatory',
  'Dining Room',
  'Billiard Room',
  'Library',
  'Lounge',
  'Hall',
  'Study',
] as const;

export type Suspect = (typeof SUSPECTS)[number];
export type Weapon = (typeof WEAPONS)[number];
export type Room = (typeof ROOMS)[number];

export type Card = Suspect | Weapon | Room;
export type Category = 'suspect' | 'weapon' | 'room';

/** The hidden answer: exactly one card of each category. */
export type SolutionTriple = {
  readonly suspect: Suspect;
  readonly weapon: Weapon;
  readonly room: Room;
};

const SUSPECT_SET: ReadonlySet<string> = new Set(SUSPECTS);
const WEAPON_SET: ReadonlySet<string> = new Set(WEAPONS);
const ROOM_SET: ReadonlySet<string> = new Set(ROOMS);

export function isSuspect(value: unknown): value is Suspect {
  return typeof value === 'string' && SUSPECT_SET.has(value);
}

export function isWeapon(value: unknown): value is Weapon {
  return typeof value === 'string' && WEAPON_SET.has(value);
}

export function isRoom(value: unknown): value is Room {
  return typeof value === 'string' && ROOM_SET.has(value);
}

export function isCard(value: unknown): value is Card {
  return isSuspect(value) || isWeapon(value) || isRoom(value);
}

/** The category a card belongs to. Throws for a non-card. */
export function cardCategory(card: Card): Category {
  if (isSuspect(card)) return 'suspect';
  if (isWeapon(card)) return 'weapon';
  if (isRoom(card)) return 'room';
  throw new TypeError(`not a card: ${String(card)}`);
}

/** All 21 cards, suspects then weapons then rooms. */
export function fullDeck(): Card[] {
  return [...SUSPECTS, ...WEAPONS, ...ROOMS];
}

/** The three cards a solution triple names, as a list. */
export function tripleToCards(triple: SolutionTriple): Card[] {
  return [triple.suspect, triple.weapon, triple.room];
}

/** Two triples name the same suspect, weapon and room. */
export function sameTriple(a: SolutionTriple, b: SolutionTriple): boolean {
  return a.suspect === b.suspect && a.weapon === b.weapon && a.room === b.room;
}
