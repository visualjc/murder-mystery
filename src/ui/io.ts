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

/**
 * The real terminal: readline over stdin/stdout, no TUI framework (ADR-0003).
 *
 * Lines are QUEUED rather than read one `rl.question` at a time. A person types
 * only when asked, but a piped script does not: it delivers every line at once,
 * and readline drops every `line` event that arrives while no question is
 * pending — so a scripted `bun run src/cli.ts < answers.txt` would lose all but
 * the first answer or two. The standing listener keeps them (ADR-0003's whole
 * point is that the game is scriptable).
 */
export function createStdio(): Io {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const buffered: string[] = [];
  const waiting: ((line: string | null) => void)[] = [];
  let closed = false;

  rl.on('line', (line: string) => {
    const next = waiting.shift();
    if (next === undefined) buffered.push(line);
    else next(line);
  });
  rl.on('close', () => {
    closed = true;
    for (const pending of waiting.splice(0)) pending(null);
  });

  return {
    write(text: string): void {
      process.stdout.write(`${text}\n`);
    },
    async ask(prompt: string): Promise<string | null> {
      process.stdout.write(prompt);
      const queued = buffered.shift();
      if (queued !== undefined) return queued.trim();
      if (closed) return null;
      const line = await new Promise<string | null>((resolve) => waiting.push(resolve));
      return line === null ? null : line.trim();
    },
    close(): void {
      if (!closed) rl.close();
    },
  };
}
