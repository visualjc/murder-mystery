/**
 * The command line of `bun run src/cli.ts` (ADR-0003: the terminal is the
 * product surface).
 *
 * Parsing is separated from the game loop so that both can be tested without a
 * process: `parseArgs` is a pure function from argv to a decision, and the
 * random seed arrives as an injected function so a test never has to tolerate a
 * value it cannot predict.
 *
 * A game is replayable from its seed, so a seed the player did not choose is
 * still printed at the start of the session — an unprintable seed would make
 * every unseeded game unreproducible.
 */

import { DEFAULT_MODEL } from '../llm/config.ts';
import { MAX_PLAYERS, MIN_PLAYERS } from '../engine/setup.ts';

export type CliOptions = {
  /** Seeds the deal, the weapon placement and every die roll. */
  readonly seed: number;
  /** False when the seed was generated for this session rather than chosen. */
  readonly seedWasGiven: boolean;
  readonly players: number;
  /** Model id for every game-master call; absent means the configured default. */
  readonly model?: string;
  /** False under `--no-llm`: pure engine text, and no network call is made. */
  readonly useLlm: boolean;
};

export type ParsedArgs =
  | { readonly kind: 'help'; readonly text: string }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'run'; readonly options: CliOptions };

export const USAGE = [
  'murder-mystery — a Clue-style deduction game with an LLM game master.',
  '',
  'Usage: bun run src/cli.ts [options]',
  '',
  'Options:',
  '  --seed <n>        Seed the deal and the dice. Default: a random seed, printed at the start',
  '                    so the game can be replayed with --seed.',
  `  --players <${MIN_PLAYERS}-${MAX_PLAYERS}>   Seats at the table. You are seat 1; the rest are played by the`,
  `                    deterministic suspect policy. Default: ${MIN_PLAYERS}.`,
  `  --model <id>      Model for scenario, narration and Q&A. Default: ${DEFAULT_MODEL}`,
  '                    (POE_MODEL overrides it).',
  '  --no-llm          Play offline: engine text only, and no network call is made.',
  '  -h, --help        Print this help and exit.',
  '',
  'In play, choose an option by its number or by its keyword (roll, move, suggest,',
  'accuse, ask, notes, end, quit).',
  '',
  `The API key is read from POE_API_KEY, in the environment or in a gitignored`,
  '.env.local at the repository root. Without one, the game still plays: it says so',
  'once and falls back to the engine\'s own text.',
].join('\n');

const HINT = 'Run `bun run src/cli.ts --help` for the flags.';

function refuse(message: string): ParsedArgs {
  return { kind: 'error', message: `${message}\n${HINT}` };
}

/**
 * Read argv (without the runtime and script paths).
 *
 * `--help` is checked before anything else so that a player who has just been
 * refused can always reach the help text, whatever else is on the line.
 */
export function parseArgs(
  argv: readonly string[],
  randomSeed: () => number = defaultRandomSeed,
): ParsedArgs {
  if (argv.includes('--help') || argv.includes('-h')) return { kind: 'help', text: USAGE };

  let seed: number | null = null;
  let players = MIN_PLAYERS;
  let model: string | undefined;
  let useLlm = true;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    if (argument === '--no-llm') {
      useLlm = false;
      continue;
    }

    const equals = argument.indexOf('=');
    const name = equals > 0 ? argument.slice(0, equals) : argument;
    const inlineValue = equals > 0 ? argument.slice(equals + 1) : null;

    if (name !== '--seed' && name !== '--players' && name !== '--model') {
      return refuse(
        argument.startsWith('-')
          ? `Unknown option: ${argument}`
          : `Unexpected argument: ${argument}`,
      );
    }

    let value = inlineValue;
    if (value === null) {
      const next = argv[index + 1];
      // A value is whatever follows, except another option — but a negative
      // number is a value, not an option, so "-5" is accepted as a seed.
      if (next === undefined || (next.startsWith('-') && Number.isNaN(Number(next)))) {
        return refuse(`${name} needs a value.`);
      }
      value = next;
      index += 1;
    }

    if (name === '--model') {
      if (value.trim().length === 0) return refuse('--model needs a value.');
      model = value.trim();
      continue;
    }

    const parsed = Number(value);
    if (name === '--seed') {
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        return refuse(`--seed must be a whole number, got ${value}`);
      }
      seed = parsed;
      continue;
    }

    if (!Number.isInteger(parsed) || parsed < MIN_PLAYERS || parsed > MAX_PLAYERS) {
      return refuse(`--players must be a whole number between ${MIN_PLAYERS} and ${MAX_PLAYERS}, got ${value}`);
    }
    players = parsed;
  }

  return {
    kind: 'run',
    options: {
      seed: seed ?? randomSeed(),
      seedWasGiven: seed !== null,
      players,
      ...(model === undefined ? {} : { model }),
      useLlm,
    },
  };
}

/** A seed small enough to type back in, drawn fresh for an unseeded session. */
export function defaultRandomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}
