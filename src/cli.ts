/**
 * `bun run src/cli.ts` — the product surface (ADR-0003), and the run contract's
 * launch command. `--help` exits 0 and is the healthcheck.
 *
 * This file is deliberately thin: parse, wire, run, report. Everything that can
 * be tested without a process lives in src/ui/.
 */

import { parseArgs } from './ui/args.ts';
import { createStdio } from './ui/io.ts';
import { runGame } from './ui/loop.ts';
import { createChatClient } from './llm/index.ts';

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.kind === 'help') {
    process.stdout.write(`${parsed.text}\n`);
    return 0;
  }
  if (parsed.kind === 'error') {
    process.stderr.write(`${parsed.message}\n`);
    return 2;
  }

  const { options } = parsed;
  const io = createStdio();
  try {
    return await runGame(
      { seed: options.seed, players: options.players, useLlm: options.useLlm },
      {
        io,
        // Built lazily and only when the LLM is on, so `--no-llm` cannot read a
        // key, resolve a base URL, or touch the network.
        createClient: () =>
          createChatClient(options.model === undefined ? {} : { model: options.model }),
      },
    );
  } finally {
    io.close();
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
