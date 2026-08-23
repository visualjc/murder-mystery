/**
 * The two-line surface the game loop is allowed to touch: write a line, ask for
 * one.
 *
 * The loop takes an `Io` rather than reaching for `process.stdout`, so a test
 * drives the REAL loop over the REAL engine with scripted answers and reads the
 * real transcript back — no game code is replaced to make it testable
 * (ADR-0003: the whole game is scriptable).
 */

import { createInterface } from 'node:readline/promises';

export type Io = {
  /** Write one line. A newline is appended; nothing else is added. */
  write(text: string): void;
  /**
   * Ask for one line. Resolves to the trimmed answer, or null at end of input —
   * a closed stdin is a player who has left, not an error.
   */
  ask(prompt: string): Promise<string | null>;
  /** Release the input handle. Safe to call more than once. */
  close(): void;
};

/** The real terminal: readline over stdin/stdout, no TUI framework (ADR-0003). */
export function createStdio(): Io {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  // One close listener for the whole session: attaching one per question would
  // leak a listener on every prompt of a long game.
  const untilClosed = new Promise<null>((resolve) => {
    rl.once('close', () => {
      closed = true;
      resolve(null);
    });
  });

  return {
    write(text: string): void {
      process.stdout.write(`${text}\n`);
    },
    async ask(prompt: string): Promise<string | null> {
      if (closed) return null;
      const answer = await Promise.race([rl.question(prompt), untilClosed]);
      return answer === null ? null : answer.trim();
    },
    close(): void {
      if (!closed) rl.close();
    },
  };
}
