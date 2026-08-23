/**
 * Text rendering for the terminal UI.
 *
 * Every function here is pure — a view in, lines out — and every one of them
 * reads a `PlayerView` or a `Notebook`, never a `GameState`. That is not a
 * style preference: `GameState` carries the case file and every hand, and the
 * screen is the one place both would be spilled (ADR-0001, view.ts).
 */

import type { Destination } from '../engine/board.ts';
import { SUSPECTS, WEAPONS, type Card } from '../engine/cards.ts';
import type { GameEvent } from '../engine/types.ts';
import { describePosition, type PlayerView } from '../engine/view.ts';
import type { Notebook } from '../gm/notebook.ts';
import type { Scenario } from '../gm/scenario.ts';

/** A card list in a stable, readable order. */
function list(cards: readonly Card[]): string {
  return cards.length === 0 ? '(none)' : [...cards].join(', ');
}

/** The opening: seed for replay, the roster, and the scenario's own paragraph. */
export function renderOpening(
  scenario: Scenario,
  session: { readonly seed: number; readonly players: number; readonly llm: string },
): string[] {
  return [
    '',
    `${scenario.setting}`,
    `The dead: ${scenario.victim}`,
    '',
    scenario.intro,
    '',
    `Seed ${session.seed} · ${session.players} at the table · ${session.llm}`,
    `Replay this exact game with: bun run src/cli.ts --seed ${session.seed} --players ${session.players}`,
  ];
}

/** The header for one of the player's turns: where they are and what they hold. */
export function renderStatus(view: PlayerView): string[] {
  const seats = view.opponents.map(
    (opponent) =>
      `${opponent.id} (${opponent.character}) in ${describePosition(opponent.position)}, ` +
      `${opponent.handSize} ${opponent.handSize === 1 ? 'card' : 'cards'}` +
      `${opponent.eliminated ? ', out of the running' : ''}`,
  );
  return [
    '',
    `── Turn ${view.turnNumber} — you are ${view.character}, in ${describePosition(view.position)} ──`,
    `Your hand: ${list(view.hand)}`,
    ...seats.map((seat) => `  ${seat}`),
    ...(view.eliminated ? ['You accused wrongly: you may still refute, but you cannot win.'] : []),
  ];
}

/** One movement option as a phrase: where it goes and what it costs. */
export function describeDestination(destination: Destination): string {
  return `${describePosition(destination.position)} (${destination.steps} ${
    destination.steps === 1 ? 'step' : 'steps'
  })`;
}

/**
 * The deduction notebook: what this seat has PROVEN and what is still open.
 * Everything shown is derived from the seat's own view, so it gives away
 * nothing the player was not already entitled to work out.
 */
export function renderNotebook(view: PlayerView, notebook: Notebook): string[] {
  const elsewhere = [...notebook.held]
    .filter(([, holder]) => holder !== view.you)
    .map(([card, holder]) => `${card} (${holder})`);
  const proven = [...notebook.caseFileCards];

  return [
    '',
    `Notebook — turn ${view.turnNumber}`,
    `  Your hand: ${list(view.hand)}`,
    `  Proven in another hand: ${elsewhere.length === 0 ? '(nothing yet)' : elsewhere.join(', ')}`,
    ...(proven.length === 0 ? [] : [`  Proven in the case file: ${proven.join(', ')}`]),
    `  Suspects still possible: ${list(notebook.suspects)}`,
    `  Weapons still possible: ${list(notebook.weapons)}`,
    `  Rooms still possible: ${list(notebook.rooms)}`,
    `  Weapons on the board: ${WEAPONS.map((weapon) => `${weapon} — ${view.weaponPositions[weapon]}`).join('; ')}`,
    ...(notebook.solution === null
      ? []
      : [
          `  Only one answer is left: ${notebook.solution.suspect} in the ${notebook.solution.room} ` +
            `with the ${notebook.solution.weapon}.`,
        ]),
  ];
}

/** Where every suspect token stands — public, and what a suggestion moves. */
export function renderSuspects(view: PlayerView): string[] {
  return SUSPECTS.map((suspect) => `  ${suspect} — ${describePosition(view.suspectPositions[suspect])}`);
}

/** The case file from the game-over event, or null before the game ends. */
function finalEvent(view: PlayerView): Extract<GameEvent, { type: 'game-over' }> | null {
  for (let index = view.events.length - 1; index >= 0; index -= 1) {
    const event = view.events[index];
    if (event?.type === 'game-over') return event;
  }
  return null;
}

/** The end of the game: the answer, and where the player finished. */
export function renderOutcome(view: PlayerView): string[] {
  const ending = finalEvent(view);
  const lines = ['', '── Case closed ──'];
  if (ending !== null) {
    lines.push(
      `The answer: ${ending.caseFile.suspect} in the ${ending.caseFile.room} with the ${ending.caseFile.weapon}.`,
    );
  }
  if (view.winner === view.you) lines.push('You solved it. The house is yours.');
  else if (view.winner === null) lines.push('Nobody solved it. The case stays open.');
  else lines.push(`${view.winner} got there first. You lose this one.`);
  return lines;
}
