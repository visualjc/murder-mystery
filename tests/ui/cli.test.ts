/**
 * The entry point as the run contract sees it: a real `bun run src/cli.ts`
 * process, with real stdio.
 *
 * This is the only test that exercises `createStdio` and the exit codes, and it
 * is the healthcheck the project publishes — if `--help` stops exiting 0, this
 * fails.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = resolve(import.meta.dir, '../../src/cli.ts');

async function run(
  args: readonly string[],
  stdin = '',
  cwd?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(['bun', 'run', CLI, ...args], {
    stdin: new TextEncoder().encode(stdin),
    stdout: 'pipe',
    stderr: 'pipe',
    ...(cwd === undefined ? {} : { cwd }),
    // No key in the environment. `loadLlmConfig` also reads .env.local from the
    // CWD, so a test that must be keyless runs from somewhere without one —
    // otherwise the maintainer's real key would send this suite to the vendor.
    env: { ...process.env, POE_API_KEY: '' },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

describe('bun run src/cli.ts', () => {
  test('--help prints the usage and exits 0 (the healthcheck)', async () => {
    const { code, stdout } = await run(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: bun run src/cli.ts');
    expect(stdout).toContain('--no-llm');
  }, 30_000);

  test('-h is the same door', async () => {
    const { code, stdout } = await run(['-h']);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: bun run src/cli.ts');
  }, 30_000);

  test('a seat count out of bounds is refused on stderr with exit 2', async () => {
    const { code, stdout, stderr } = await run(['--players', '2']);
    expect(code).toBe(2);
    expect(stderr).toContain('--players must be a whole number between 3 and 6');
    expect(stderr).toContain('--help');
    expect(stdout).toBe('');
  }, 30_000);

  test('an unknown flag is refused rather than ignored', async () => {
    const { code, stderr } = await run(['--turbo']);
    expect(code).toBe(2);
    expect(stderr).toContain('Unknown option: --turbo');
  }, 30_000);

  test('a whole offline game plays over real stdin and ends with the ledger', async () => {
    // Always answer "1": roll, take the first destination, suggest, show the
    // first card. It never accuses, so the game is finished by the suspects.
    const answers = `${'1\n'.repeat(600)}`;
    const { code, stdout } = await run(['--no-llm', '--seed', '2', '--players', '3'], answers);

    expect(code).toBe(0);
    expect(stdout).toContain('Seed 2 · 3 at the table · offline (--no-llm)');
    expect(stdout).toContain('── Case closed ──');
    expect(stdout).toMatch(/The answer: .+ in the .+ with the .+\./);
    expect(stdout).toContain('No LLM calls were made this session.');
  }, 60_000);

  test('closing stdin immediately still leaves cleanly', async () => {
    const { code, stdout } = await run(['--no-llm', '--seed', '3'], '');
    expect(code).toBe(0);
    expect(stdout).toContain('You leave the house with the case unsolved.');
  }, 30_000);

  test('without a key the game still starts, offline, saying so once', async () => {
    // No --no-llm: the client cannot be built, and that is a notice, not a
    // crash. Run from a directory with no .env.local so no key can be found.
    const { code, stdout } = await run(['--seed', '3'], 'quit\n', mkdtempSync(join(tmpdir(), 'mm-cli-')));
    expect(code).toBe(0);
    expect(stdout).toContain('(no game master: Missing POE_API_KEY');
    expect(stdout).toContain('playing offline');
    expect(stdout).toContain('No LLM calls were made this session.');
  }, 30_000);
});
