/**
 * The deduction notebook: everything ONE seat can prove about where cards are.
 *
 * Pure closed-world logic over a `PlayerView` — the seat's own hand plus the
 * events addressed to it. No LLM, no network, no randomness: two seats holding
 * the same view always reach the same notebook, which is what makes the
 * LLM-driven suspects' play deterministic and replayable (ADR-0001).
 *
 * The refutation rule is the CORRECTED one (engine finding, run e6g6g38j). A
 * refuter shows a card THEY hold, so of the three cards a refuted suggestion
 * named:
 *
 *   - a card already proven to be in ANOTHER player's hand is excluded — the
 *     refuter cannot have shown a card they do not hold;
 *   - a card already proven to be the REFUTER'S OWN stays a candidate — it is
 *     precisely what they could have shown;
 *   - a card already proven to be in the case file is excluded — nobody holds
 *     it.
 *
 * When exactly one candidate survives, the refuter holds it. The naive form
 * ("two of the three are located, so the refuter holds the third") ignores the
 * middle case and derives FALSE card locations.
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
import type { PlayerId } from '../engine/types.ts';
import type { PlayerView } from '../engine/view.ts';

export type Notebook = {
  /** The seat this notebook reasons for. */
  readonly you: PlayerId;
  /** Cards whose holder is PROVEN, and who holds them. */
  readonly held: ReadonlyMap<Card, PlayerId>;
  /** Cards proven to be in the case file — held by nobody. */
  readonly caseFileCards: ReadonlySet<Card>;
  /** Suspects still possible as the case-file suspect, in deck order. */
  readonly suspects: readonly Suspect[];
  readonly weapons: readonly Weapon[];
  readonly rooms: readonly Room[];
  /** The single remaining triple, or null while any category has a choice. */
  readonly solution: SolutionTriple | null;
};

/** One refuted suggestion as this seat saw it: what was named, and by whom it was answered. */
type SeenRefutation = { readonly named: readonly Card[]; readonly refuter: PlayerId };

export function buildNotebook(view: PlayerView): Notebook {
  const hand = new Set<Card>(view.hand);
  const held = new Map<Card, PlayerId>();
  for (const card of view.hand) held.set(card, view.you);

  const caseFileCards = new Set<Card>();
  const refutations: SeenRefutation[] = [];
  let openSuggestion: { player: PlayerId; named: readonly Card[] } | null = null;

  for (const event of view.events) {
    switch (event.type) {
      case 'suggestion-made':
        openSuggestion = { player: event.player, named: [event.suspect, event.weapon, event.room] };
        break;
      case 'refutation-card-shown':
        // Shown to this seat (or by it): the holder is settled, no inference needed.
        held.set(event.card, event.refuter);
        break;
      case 'suggestion-refuted':
        if (openSuggestion !== null) {
          refutations.push({ named: openSuggestion.named, refuter: event.refuter });
        }
        break;
      case 'suggestion-unrefuted':
        // Nobody but the suggester can hold any of the three named cards. When
        // the suggester is this seat, a named card that is not in our own hand
        // is held by nobody at all — it is in the case file.
        if (openSuggestion !== null && event.player === view.you) {
          for (const card of openSuggestion.named) if (!hand.has(card)) caseFileCards.add(card);
        }
        break;
      default:
        break;
    }
  }

  // Fixpoint: each conclusion can narrow another refutation's options.
  let changed = true;
  while (changed) {
    changed = false;
    for (const { named, refuter } of refutations) {
      const possible = named.filter((card) => {
        if (caseFileCards.has(card)) return false;
        const holder = held.get(card);
        return holder === undefined || holder === refuter;
      });
      const only = possible[0];
      if (possible.length === 1 && only !== undefined && !held.has(only)) {
        held.set(only, refuter);
        changed = true;
      }
    }
  }

  const openIn = <T extends Card>(all: readonly T[]): T[] => {
    const proven = all.filter((card) => caseFileCards.has(card));
    if (proven.length === 1) return proven;
    return all.filter((card) => !held.has(card));
  };

  const suspects = openIn(SUSPECTS);
  const weapons = openIn(WEAPONS);
  const rooms = openIn(ROOMS);
  const suspect = suspects[0];
  const weapon = weapons[0];
  const room = rooms[0];

  return {
    you: view.you,
    held,
    caseFileCards,
    suspects,
    weapons,
    rooms,
    solution:
      suspects.length === 1 &&
      weapons.length === 1 &&
      rooms.length === 1 &&
      suspect !== undefined &&
      weapon !== undefined &&
      room !== undefined
        ? { suspect, weapon, room }
        : null,
  };
}
