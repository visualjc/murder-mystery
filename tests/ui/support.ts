/**
 * Rigging for the UI tests.
 *
 * Nothing here replaces game code. The tests drive the REAL `runGame` over the
 * REAL engine and the REAL game master; the only thing standing in for a person
 * is a function that reads the transcript the loop has just printed and types an
 * answer back — which is exactly what a player does.
 */

import type { Io } from '../../src/ui/io.ts';

export type Session = {
  readonly io: Io;
  /** Every line the loop has written, in order. */
  readonly lines: string[];
  /** Every answer the driver typed, in order. */
  readonly answers: string[];
  text(): string;
};

export type Driver = (lines: readonly string[], prompt: string) => string | null;

/**
 * An `Io` whose answers come from `driver`. Returning null closes stdin, which
 * the loop treats as a player who has left.
 */
export function drivenSession(driver: Driver, maxAnswers = 20_000): Session {
  const lines: string[] = [];
  const answers: string[] = [];
  const io: Io = {
    write(text: string): void {
      lines.push(text);
    },
    async ask(prompt: string): Promise<string | null> {
      if (answers.length >= maxAnswers) {
        throw new Error(`driver was asked more than ${maxAnswers} questions — the loop is not progressing`);
      }
      const answer = driver(lines, prompt);
      if (answer !== null) answers.push(answer);
      return answer;
    },
    close(): void {
      /* nothing to release: the driver is a function */
    },
  };
  return { io, lines, answers, text: () => lines.join('\n') };
}

/** A driver that reads a fixed list of answers, then closes stdin. */
export function scriptedDriver(script: readonly string[]): Driver {
  let index = 0;
  return () => (index < script.length ? (script[index++] as string) : null);
}

/**
 * The menu the loop printed last: the trailing run of numbered option lines.
 * Menus are always written immediately before the prompt, so the last such run
 * is what the player is being asked about.
 */
export function lastMenu(lines: readonly string[]): string[] {
  const menu: string[] = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] as string;
    if (/^ {2}\d+\) /.test(line)) menu.unshift(line);
    else if (menu.length > 0) break;
  }
  return menu;
}

/** The line the loop printed directly above the last menu: the question itself. */
export function lastTitle(lines: readonly string[]): string {
  const menu = lastMenu(lines);
  return lines[lines.length - menu.length - 1] ?? '';
}

/** The 1-based position of the first option matching `predicate`, or null. */
export function findOption(menu: readonly string[], predicate: (line: string) => boolean): number | null {
  const index = menu.findIndex(predicate);
  return index < 0 ? null : index + 1;
}

/**
 * A player who plays a plain, deterministic game: walk into a room, suggest
 * there, otherwise roll and end the turn. It never accuses, so a game this
 * driver finishes was finished by the suspects' own deduction.
 */
export function plainPlayer(options: { readonly stopAfter?: number } = {}): Driver {
  let asked = 0;
  return (lines) => {
    asked += 1;
    if (options.stopAfter !== undefined && asked > options.stopAfter) return null;
    const menu = lastMenu(lines);
    if (menu.length === 0) return '1';

    const room = findOption(menu, (line) => line.includes('move to the '));
    if (room !== null) return String(room);

    for (const keyword of ['suggest', 'roll', 'end']) {
      const found = findOption(menu, (line) => line.includes(`) ${keyword} — `));
      if (found !== null) return String(found);
    }
    return '1';
  };
}
