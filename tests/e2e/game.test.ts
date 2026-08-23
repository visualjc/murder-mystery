/**
 * The whole product, end to end.
 *
 * The per-slice suites prove their own layer: the engine's rules, the game
 * master's prompts, the client's transport, the loop's menus. This file proves
 * the thing those layers add up to — a game a person can actually play, from
 * the first line of fiction to the last line of the token ledger — and it does
 * it twice over, once through the LLM path and once through a real process with
 * the network switched off.
 *
 * Nothing here is mocked. The "vendor" is the real in-process HTTP server from
 * tests/llm/fake-vendor.ts, reached over TCP by the real `ChatClient`; the
 * "player" is a function that reads the transcript the loop just printed and
 * types an answer back; and the offline cases are a real `bun run src/cli.ts`
 * child process reading a real file on stdin.
 *
 * Deliberately NOT repeated here (they belong to tests/ui/loop.test.ts and
 * tests/ui/cli.test.ts, and a second copy would rot): menu resolution, bad
 * input, the notebook, the refutation prompt's contents, --help, and argument
 * errors. What only this file can show is the join between them.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createGame } from '../../src/engine/setup.ts';
import { SUSPECTS } from '../../src/engine/cards.ts';
import { HUMAN_SEAT, runGame } from '../../src/ui/loop.ts';
import { clientFor } from '../gm/support.ts';
import { completionResponse, errorResponse, startFakeVendor } from '../llm/fake-vendor.ts';
import {
  drivenSession,
  findOption,
  lastMenu,
  lastTitle,
  plainPlayer,
  type Driver,
} from '../ui/support.ts';

const CLI = resolve(import.meta.dir, '../../src/cli.ts');

// ─── the LLM-path game ──────────────────────────────────────────────────────

/** The model id the vendor answers as. `clientFor` asks for this one. */
const MODEL = 'Test-Model';

/** Fiction only this vendor could have invented: finding it proves it was used. */
const VICTIM = 'Sir Hollis Marchbank';
const SETTING = 'A tidal island house, the winter of 1927';
const INTRO = 'The causeway drowned at four and the shooting party came back one man short.';
/** Stamped into every narrated line so a vendor line is unmistakable on screen. */
const NARRATION_MARK = '[from the game master]';
const QUESTION = 'Where were you when the lamps went out?';
const ANSWER = 'I was on the stairs with a cold cup of tea, and I resent the implication.';

/** The narration call (1-based, counting narration calls only) that is refused. */
const FAILING_NARRATION_CALL = 4;
/** The turn the scripted player stops investigating and names a murderer. */
const ACCUSE_FROM_TURN = 4;

type ServedUsage = { prompt_tokens: number; completion_tokens: number; total_tokens: number };

/** The three prompts the game master sends, told apart by their own wording. */
function classify(prompt: string): 'scenario' | 'narration' | 'qa' | 'unknown' {
  if (prompt.includes('Return exactly this JSON shape')) return 'scenario';
  if (prompt.includes('You are the narrator of a parlour-murder mystery')) return 'narration';
  if (prompt.includes('a guest questioned about a death in the house')) return 'qa';
  return 'unknown';
}

function promptOf(body: unknown): string {
  const messages = (body as { messages?: { content?: unknown }[] }).messages ?? [];
  return messages.map((message) => String(message.content ?? '')).join('\n');
}

/** The 1-based position of the option whose label is exactly `card`. */
function optionFor(menu: readonly string[], card: string): number {
  const found = findOption(menu, (line) => line.replace(/^ {2}\d+\) /, '') === card);
  if (found === null) {
    throw new Error(`the menu never offered "${card}":\n${menu.join('\n')}`);
  }
  return found;
}

/** The turn number of the last turn header the loop printed, or 0 before the first. */
function currentTurn(lines: readonly string[]): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = /^── Turn (\d+) —/.exec(lines[index] as string);
    if (match !== null) return Number(match[1]);
  }
  return 0;
}

/**
 * A player with a plan: play plainly, question a suspect once on the first
 * turn, and from `ACCUSE_FROM_TURN` name the triple in the case file.
 *
 * The triple comes from `createGame` with the same seed — the test computes the
 * ground truth the same way the engine did, rather than reading it off the
 * screen (the screen never shows it, which is the point). That is what makes a
 * WIN scriptable: a player who guesses cannot be relied upon to finish, and a
 * game that ends by an opponent's deduction would never exercise the human
 * seat's accusation path at all.
 */
function scriptedInvestigator(caseFile: {
  suspect: string;
  weapon: string;
  room: string;
}): Driver {
  const plain = plainPlayer();
  let asked = false;
  return (lines, promptText) => {
    const title = lastTitle(lines);
    const menu = lastMenu(lines);

    if (promptText.startsWith('Ask ')) return QUESTION;
    if (title === 'Whom will you question?') return '1';
    if (title === 'Who did it?') return String(optionFor(menu, caseFile.suspect));
    if (title === 'With what?') return String(optionFor(menu, caseFile.weapon));
    if (title === 'Where?') return String(optionFor(menu, caseFile.room));

    if (title === 'What will you do?') {
      if (!asked) {
        const ask = findOption(menu, (line) => line.includes(') ask — '));
        if (ask !== null) {
          asked = true;
          return String(ask);
        }
      }
      if (currentTurn(lines) >= ACCUSE_FROM_TURN) {
        const accuse = findOption(menu, (line) => line.includes(') accuse — '));
        if (accuse !== null) return String(accuse);
      }
    }
    return plain(lines, promptText);
  };
}

describe('a whole game played through the game master', () => {
  test('scenario, narration, Q&A, one degraded call, the win, and a ledger that matches the vendor', async () => {
    const seed = 1;
    const caseFile = createGame({ seed, playerCount: 3 }).caseFile;

    /** Every usage object the vendor actually served, in order. The ledger's source of truth. */
    const served: ServedUsage[] = [];
    /** What each request was for, in arrival order — the shape of the session. */
    const kinds: string[] = [];
    let narrationCalls = 0;

    /** A success whose token figures differ per call, so a summed ledger cannot pass by luck. */
    const serve = (content: string) => {
      const index = served.length;
      const usage: ServedUsage = {
        prompt_tokens: 40 + index * 7,
        completion_tokens: 5 + index * 3,
        total_tokens: 45 + index * 10,
      };
      served.push(usage);
      return completionResponse({ content, model: MODEL, usage });
    };

    const vendor = startFakeVendor((request) => {
      const prompt = promptOf(request.body);
      const kind = classify(prompt);
      kinds.push(kind);

      if (kind === 'scenario') {
        return serve(
          JSON.stringify({
            victim: VICTIM,
            setting: SETTING,
            intro: INTRO,
            suspects: SUSPECTS.map((suspect) => ({
              name: suspect,
              persona: `${suspect} answers slowly and watches the door.`,
            })),
          }),
        );
      }

      if (kind === 'narration') {
        narrationCalls += 1;
        // One call is refused mid-game with a 400: the transport does not retry
        // a 4xx, so this is exactly ONE failed game-master call — the narration
        // for that flush falls back to the engine's own sentences and the
        // session carries on. It must stay a single failure: two IN A ROW would
        // open the breaker and take the rest of the game offline, which is the
        // scenario tests/ui/loop.test.ts already pins.
        if (narrationCalls === FAILING_NARRATION_CALL) {
          return errorResponse(400, 'the narrator has lost the thread');
        }
        const count = (prompt.match(/^\d+\. /gm) ?? []).length;
        return serve(
          JSON.stringify(
            Array.from({ length: count }, (_unused, index) => `${NARRATION_MARK} beat ${index + 1}.`),
          ),
        );
      }

      if (kind === 'qa') return serve(ANSWER);
      return errorResponse(500, `unclassifiable prompt: ${prompt.slice(0, 200)}`);
    });

    try {
      const session = drivenSession(scriptedInvestigator(caseFile));
      const client = clientFor(vendor.baseUrl, { retryBackoffMs: 1 });
      const code = await runGame(
        { seed, players: 3, useLlm: true },
        { io: session.io, createClient: () => client },
      );
      const text = session.text();
      const lines = session.lines;

      // 1. The session ran, and it ran against the vendor.
      expect(code).toBe(0);
      expect(kinds).not.toContain('unknown');
      expect(kinds[0]).toBe('scenario');
      expect(kinds).toContain('qa');
      expect(narrationCalls).toBeGreaterThan(FAILING_NARRATION_CALL);

      // 2. The opening is the vendor's fiction, not the canned one.
      expect(text).toContain(`The dead: ${VICTIM}`);
      expect(text).toContain(SETTING);
      expect(text).toContain(INTRO);
      expect(text).not.toContain('The dead: Doctor Alastair Vane');
      expect(text).toContain(`Seed ${seed} · 3 at the table · game master: ${MODEL}`);

      // 3. The turns were narrated in the vendor's words.
      const narrated = lines.filter((line) => line.includes(NARRATION_MARK));
      expect(narrated.length).toBeGreaterThan(1);
      for (const line of narrated) expect(line.startsWith('  ')).toBe(true);

      // 4. One call was refused, the player was told once, and the game went on
      //    speaking in the model's voice afterwards — so the fallback was a dip,
      //    not the end of the game master.
      const notice = lines.findIndex((line) => line.includes('the game master is not answering'));
      expect(notice).toBeGreaterThan(-1);
      expect(lines.filter((line) => line.includes('the game master is not answering'))).toHaveLength(1);
      expect(lines.findIndex((line) => line.includes(NARRATION_MARK))).toBeLessThan(notice);
      expect(lines.findLastIndex((line) => line.includes(NARRATION_MARK))).toBeGreaterThan(notice);
      expect(text).not.toContain('LLM disabled for this session');
      // The refused batch was told anyway, in the engine's own sentences — the
      // notice is followed by narration that plainly did not come from a model.
      const degraded = lines[notice + 1] as string;
      expect(degraded).not.toContain(NARRATION_MARK);
      expect(degraded).toMatch(/^ {2}p\d .*\.$/);

      // 5. A question was put to a suspect and answered in character, and the
      //    prompt that produced it carried the question the player typed.
      const spoken = lines.filter((line) => /^ {2}[^:]+: "/.test(line));
      expect(spoken).toHaveLength(1);
      const speaker = (spoken[0] as string).slice(2, (spoken[0] as string).indexOf(':'));
      expect(SUSPECTS as readonly string[]).toContain(speaker);
      expect(spoken[0]).toBe(`  ${speaker}: "${ANSWER}"`);
      const qaRequest = vendor.requests.find((request) => classify(promptOf(request.body)) === 'qa');
      expect(promptOf(qaRequest?.body)).toContain(`asks you: ${QUESTION}`);

      // 6. The human seat's accusation ended the game, and the reveal is the
      //    triple the engine dealt from this seed.
      expect(text).toContain('An accusation is final');
      expect(text).toContain('── Case closed ──');
      expect(text).toContain(
        `The answer: ${caseFile.suspect} in the ${caseFile.room} with the ${caseFile.weapon}.`,
      );
      expect(text).toContain('You solved it. The house is yours.');
      expect(lines.filter((line) => line.startsWith('The answer: '))).toHaveLength(1);

      // 7. The ledger is the vendor's own numbers, summed. Every completed call
      //    reported usage; the refused one is reported as an attempt, not a
      //    completion, and contributes no tokens. The attempt count is on the
      //    line too — this assertion used to read `N calls, 1 failed attempt,`,
      //    which named the failed call but hid how many exchanges the session
      //    actually spent (panel finding, codex).
      const totals = served.reduce(
        (sum, usage) => ({
          prompt: sum.prompt + usage.prompt_tokens,
          completion: sum.completion + usage.completion_tokens,
          total: sum.total + usage.total_tokens,
        }),
        { prompt: 0, completion: 0, total: 0 },
      );
      expect(vendor.requests).toHaveLength(served.length + 1);
      expect(client.usage.attempts).toBe(vendor.requests.length);
      expect(text).toContain(
        `LLM usage: ${served.length} calls (${vendor.requests.length} attempts, 1 failed), ` +
          `${totals.total} tokens (${totals.prompt} prompt + ${totals.completion} completion)`,
      );
      expect(text).toContain(
        `  test-model: ${served.length} calls, ${totals.total} tokens ` +
          `(${totals.prompt} prompt + ${totals.completion} completion)`,
      );
      expect(text).not.toContain('reported no usage');
      expect(client.usage.calls).toBe(served.length);
      expect(client.usage.failures).toBe(1);
      expect(client.usage.total_tokens).toBe(totals.total);

      // 8. The screen never spilled what only the engine knew: the case file is
      //    named once, in the reveal, after the game is over.
      const revealAt = lines.findIndex((line) => line.startsWith('The answer: '));
      const before = lines.slice(0, revealAt).join('\n');
      expect(before).not.toContain(
        `${caseFile.suspect} in the ${caseFile.room} with the ${caseFile.weapon}`,
      );
      expect(HUMAN_SEAT).toBe('p1');
    } finally {
      await vendor.stop();
    }
  }, 60_000);
});

// ─── the offline game, through a real process ───────────────────────────────

/**
 * Always answer "1": roll, take the first destination offered, suggest there,
 * show the first card owed. Option 1 is never `accuse`, so a game this script
 * finishes was finished by the suspects' own deduction.
 */
const ANSWERS = '1\n'.repeat(800);
/** Short and decisive under the "always 1" script: a whole game in a few hundred lines. */
const OFFLINE_SEED = 5;

type ProcessRun = { code: number; stdout: string; stderr: string };

/**
 * One real `bun run src/cli.ts` game, from a directory that is NOT the repo.
 *
 * The cwd matters: `loadLlmConfig` reads `.env.local` from the working
 * directory, so a child started in the repo would find the maintainer's real
 * key and a test could bill a live endpoint. A fresh mkdtemp has no such file,
 * and the emptied `POE_API_KEY` closes the environment door as well — belt and
 * braces around a hazard that is cheap to prevent and expensive to discover.
 */
async function playOffline(seed: number): Promise<ProcessRun> {
  const dir = mkdtempSync(join(tmpdir(), 'mm-e2e-'));
  const script = join(dir, 'answers.txt');
  writeFileSync(script, ANSWERS);

  const child = Bun.spawn(['bun', 'run', CLI, '--no-llm', '--seed', String(seed), '--players', '3'], {
    cwd: dir,
    stdin: Bun.file(script),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, POE_API_KEY: '' },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

describe('the offline game as the run contract ships it', () => {
  test('a real process plays a scripted game to the reveal with zero network', async () => {
    const { code, stdout, stderr } = await playOffline(OFFLINE_SEED);

    expect(stderr).toBe('');
    expect(code).toBe(0);

    // The whole arc, in the order a player sees it.
    expect(stdout).toContain('The dead: Doctor Alastair Vane');
    expect(stdout).toContain(`Seed ${OFFLINE_SEED} · 3 at the table · offline (--no-llm)`);
    expect(stdout).toContain(
      `Replay this exact game with: bun run src/cli.ts --seed ${OFFLINE_SEED} --players 3`,
    );
    expect(stdout).toContain('── Turn 1 — you are ');
    expect(stdout).toContain('── Case closed ──');
    expect(stdout).toMatch(/The answer: .+ in the .+ with the .+\./);

    // Not a client that failed quietly: no client was ever built.
    expect(stdout).toContain('No LLM calls were made this session.');
    expect(stdout).not.toContain('no game master');
    expect(stdout).not.toContain('the game master is not answering');
    expect(stdout).not.toContain('LLM usage:');

    // It was a game, not a stub: dozens of turns of real play.
    expect(stdout.split('\n').filter((line) => line.startsWith('── Turn ')).length).toBeGreaterThan(3);
  }, 120_000);

  test('the same seed and the same answers replay byte for byte in a separate process', async () => {
    const first = await playOffline(OFFLINE_SEED);
    const second = await playOffline(OFFLINE_SEED);

    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(first.stdout).toContain('── Case closed ──');
    // Nothing is stripped before the comparison: the seed is fixed and printed,
    // and there is no clock, no random port and no path in the transcript. If a
    // process ever prints one, this is the test that says so.
    expect(second.stdout).toBe(first.stdout);
    expect(first.stdout.length).toBeGreaterThan(2_000);
  }, 180_000);
});
