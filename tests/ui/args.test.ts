/**
 * Argument parsing for the terminal entry point.
 *
 * `--help` is the run contract's healthcheck, so its shape is asserted here as
 * well as end to end in cli.test.ts: it must exit 0 and actually document the
 * flags, not merely print something.
 */

import { describe, expect, test } from 'bun:test';
import { parseArgs, USAGE } from '../../src/ui/args.ts';
import { DEFAULT_MODEL } from '../../src/llm/config.ts';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../src/engine/setup.ts';

describe('parseArgs — help', () => {
  test.each([['--help'], ['-h']])('%s asks for usage', (flag) => {
    const parsed = parseArgs([flag]);
    expect(parsed.kind).toBe('help');
    if (parsed.kind !== 'help') throw new Error('expected help');
    expect(parsed.text).toBe(USAGE);
  });

  test('usage documents every flag and the launch command', () => {
    expect(USAGE).toContain('bun run src/cli.ts');
    for (const flag of ['--seed', '--players', '--model', '--no-llm', '--help']) {
      expect(USAGE).toContain(flag);
    }
    // The default model must be documented from the one constant that defines
    // it, so the help text cannot drift away from what the client actually uses.
    expect(USAGE).toContain(DEFAULT_MODEL);
    expect(USAGE).toContain(`${MIN_PLAYERS}-${MAX_PLAYERS}`);
  });

  test('help wins even when other flags are present', () => {
    expect(parseArgs(['--players', '9', '--help']).kind).toBe('help');
  });
});

describe('parseArgs — defaults', () => {
  test('no arguments means three seats, the LLM on, and a generated seed', () => {
    const parsed = parseArgs([], () => 4242);
    if (parsed.kind !== 'run') throw new Error(`expected run, got ${parsed.kind}`);
    expect(parsed.options).toEqual({
      seed: 4242,
      seedWasGiven: false,
      players: MIN_PLAYERS,
      useLlm: true,
    });
  });

  test('the generated seed is what the caller supplies, so a replay is printable', () => {
    const parsed = parseArgs([], () => 7);
    if (parsed.kind !== 'run') throw new Error('expected run');
    expect(parsed.options.seed).toBe(7);
    expect(parsed.options.seedWasGiven).toBe(false);
  });
});

describe('parseArgs — flags', () => {
  test('reads seed, players, model and --no-llm together', () => {
    const parsed = parseArgs(['--seed', '11', '--players', '5', '--model', 'gpt-4o', '--no-llm']);
    if (parsed.kind !== 'run') throw new Error('expected run');
    expect(parsed.options).toEqual({
      seed: 11,
      seedWasGiven: true,
      players: 5,
      model: 'gpt-4o',
      useLlm: false,
    });
  });

  test('--flag=value form is accepted', () => {
    const parsed = parseArgs(['--seed=3', '--players=4']);
    if (parsed.kind !== 'run') throw new Error('expected run');
    expect(parsed.options.seed).toBe(3);
    expect(parsed.options.players).toBe(4);
  });

  test('a negative seed is a seed, not a missing value', () => {
    const parsed = parseArgs(['--seed', '-5']);
    if (parsed.kind !== 'run') throw new Error('expected run');
    expect(parsed.options.seed).toBe(-5);
  });
});

describe('parseArgs — refusals', () => {
  test.each([
    ['2 seats', ['--players', '2'], `between ${MIN_PLAYERS} and ${MAX_PLAYERS}`],
    ['7 seats', ['--players', '7'], `between ${MIN_PLAYERS} and ${MAX_PLAYERS}`],
    ['fractional seats', ['--players', '3.5'], `between ${MIN_PLAYERS} and ${MAX_PLAYERS}`],
    ['non-numeric seats', ['--players', 'lots'], `between ${MIN_PLAYERS} and ${MAX_PLAYERS}`],
    ['non-numeric seed', ['--seed', 'abc'], '--seed'],
    ['seed with no value', ['--seed'], '--seed'],
    ['players with no value', ['--players'], '--players'],
    ['model with no value', ['--model'], '--model'],
    ['unknown flag', ['--turbo'], '--turbo'],
    ['stray argument', ['play'], 'play'],
  ])('%s is refused with a message naming the problem', (_name, argv, needle) => {
    const parsed = parseArgs(argv);
    expect(parsed.kind).toBe('error');
    if (parsed.kind !== 'error') throw new Error('expected error');
    expect(parsed.message).toContain(needle);
    // Every refusal points at the one command that explains the flags.
    expect(parsed.message).toContain('--help');
  });

  test('the bounds refusal names the flag it is about', () => {
    const parsed = parseArgs(['--players', '2']);
    if (parsed.kind !== 'error') throw new Error('expected error');
    expect(parsed.message).toContain('--players');
  });
});
