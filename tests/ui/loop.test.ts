/**
 * The terminal game loop, driven end to end.
 *
 * Every test here runs the REAL `runGame` over the REAL engine and, where the
 * game master is involved, over the REAL in-process vendor from
 * tests/llm/fake-vendor.ts. Nothing is mocked: the only thing standing in for a
 * person is a function that reads the transcript and types an answer.
 */

import { describe, expect, test } from 'bun:test';
import { HUMAN_SEAT, resolveChoice, runGame } from '../../src/ui/loop.ts';
import { drivenSession, lastMenu, lastTitle, plainPlayer, scriptedDriver, type Driver } from './support.ts';
import { completionResponse, errorResponse, startFakeVendor } from '../llm/fake-vendor.ts';
import { clientFor } from '../gm/support.ts';
import { ROOMS, SUSPECTS, WEAPONS } from '../../src/engine/cards.ts';

const OFFLINE = { seed: 1, players: 3, useLlm: false } as const;

/** Every card named on the "Your hand:" line the loop printed for the player. */
function handFrom(lines: readonly string[]): string[] {
  const line = lines.find((candidate) => candidate.startsWith('Your hand: '));
  if (line === undefined) throw new Error('the loop never printed the player\'s hand');
  return line.slice('Your hand: '.length).split(', ');
}

describe('a full offline game', () => {
  test('reaches game over from a fixed seed, with no client and no network', async () => {
    const session = drivenSession(plainPlayer());
    // No `createClient` at all: there is nothing in this run that COULD make a
    // request, which is what --no-llm has to mean.
    const code = await runGame(OFFLINE, { io: session.io });
    const text = session.text();

    expect(code).toBe(0);
    expect(text).toContain('Seed 1 · 3 at the table · offline (--no-llm)');
    expect(text).toContain('bun run src/cli.ts --seed 1 --players 3');
    // The canned scenario is used verbatim when there is no game master.
    expect(text).toContain('The dead: Doctor Alastair Vane');
    expect(text).toContain('── Turn 1 — you are Miss Scarlett');
    expect(text).toContain('── Case closed ──');
    expect(text).toMatch(/The answer: .+ in the .+ with the .+\./);
    expect(text).toContain('No LLM calls were made this session.');
    expect(session.answers.length).toBeGreaterThan(10);
  });

  test('the same seed and the same answers replay exactly', async () => {
    const first = drivenSession(plainPlayer());
    await runGame(OFFLINE, { io: first.io });
    const second = drivenSession(plainPlayer());
    await runGame(OFFLINE, { io: second.io });

    expect(second.text()).toBe(first.text());
    expect(second.answers).toEqual(first.answers);
  });

  test('a different seed is a different game', async () => {
    const first = drivenSession(plainPlayer());
    await runGame(OFFLINE, { io: first.io });
    const other = drivenSession(plainPlayer());
    await runGame({ ...OFFLINE, seed: 2 }, { io: other.io });

    expect(other.text()).not.toBe(first.text());
    expect(other.text()).toContain('── Case closed ──');
  });

  test('the answer is revealed only at the end, and only once', async () => {
    const session = drivenSession(plainPlayer());
    await runGame(OFFLINE, { io: session.io });

    const reveals = session.lines.filter((line) => line.startsWith('The answer: '));
    expect(reveals).toHaveLength(1);
    expect(session.lines.indexOf(reveals[0] as string)).toBeGreaterThan(
      session.lines.indexOf('── Case closed ──'),
    );
  });

  test('four, five and six seats all play to a finish', async () => {
    for (const players of [4, 5, 6]) {
      const session = drivenSession(plainPlayer());
      const code = await runGame({ seed: 7, players, useLlm: false }, { io: session.io });
      expect(code).toBe(0);
      expect(session.text()).toContain('── Case closed ──');
    }
  }, 30_000);
});

describe('the refutation the player owes', () => {
  /**
   * Seed 2 puts the player in front of a choice: a suggestion they can answer
   * with either of two cards. The engine parks in `awaiting-refutation` and the
   * loop must be the thing that asks.
   */
  test('offers only cards from the player\'s own hand, and play continues after the choice', async () => {
    const menus: string[][] = [];
    const player = plainPlayer();
    const driver: Driver = (lines, promptText) => {
      if (lastTitle(lines).includes('you must show ONE of these')) menus.push(lastMenu(lines));
      return player(lines, promptText);
    };

    const session = drivenSession(driver);
    await runGame({ seed: 2, players: 3, useLlm: false }, { io: session.io });
    const text = session.text();

    expect(menus.length).toBeGreaterThan(0);
    const hand = handFrom(session.lines);
    const offered = (menus[0] as string[]).map((line) => line.replace(/^ {2}\d+\) /, ''));
    expect(offered.length).toBeGreaterThan(1);
    for (const card of offered) expect(hand).toContain(card);

    // The choice was made, the table learned only THAT it happened, and the
    // game moved on rather than deadlocking on the pending refutation.
    expect(text).toContain(`${HUMAN_SEAT} refutes`);
    expect(text).toContain('── Case closed ──');
  });

  test('a suggestion the player cannot answer is never turned into a prompt', async () => {
    // p1 makes suggestions of its own all game; the loop must only ask for a
    // card when the ENGINE says this seat owes one.
    const session = drivenSession(plainPlayer());
    await runGame(OFFLINE, { io: session.io });

    const prompts = session.lines.filter((line) => line.includes('you must show ONE of these'));
    const refusals = session.lines.filter((line) =>
      line.startsWith('That will not work: ') && line.includes('refutation'),
    );
    expect(refusals).toHaveLength(0);
    for (const line of prompts) expect(line).toContain('waiting');
  });
});

describe('bad input', () => {
  test('an answer that means nothing is reprinted, not fatal', async () => {
    const player = plainPlayer();
    let injected = false;
    const driver: Driver = (lines, promptText) => {
      if (!injected) {
        injected = true;
        return 'banana';
      }
      return player(lines, promptText);
    };

    const session = drivenSession(driver);
    const code = await runGame(OFFLINE, { io: session.io });

    expect(session.text()).toContain('I do not understand "banana"');
    // The same menu is offered again: the first two prompts are the same block.
    expect(session.lines.filter((line) => line === 'What will you do?').length).toBeGreaterThan(1);
    expect(code).toBe(0);
    expect(session.text()).toContain('── Case closed ──');
  });

  test('a legal word for an illegal move is refused in the engine\'s own words', async () => {
    const player = plainPlayer();
    let injected = false;
    const driver: Driver = (lines, promptText) => {
      if (!injected) {
        injected = true;
        // Turn 1: the player is in a corridor and has not rolled. "suggest" is
        // a real command, but not a legal one here.
        return 'suggest';
      }
      return player(lines, promptText);
    };

    const session = drivenSession(driver);
    const code = await runGame(OFFLINE, { io: session.io });

    expect(session.text()).toContain('That will not work: p1 must be in a room to suggest');
    expect(code).toBe(0);
    expect(session.text()).toContain('── Case closed ──');
  });

  test('closing stdin ends the session and still prints the ledger', async () => {
    const session = drivenSession(scriptedDriver([]));
    const code = await runGame(OFFLINE, { io: session.io });

    expect(code).toBe(0);
    expect(session.text()).toContain('You leave the house with the case unsolved.');
    expect(session.text()).toContain('No LLM calls were made this session.');
    expect(session.text()).not.toContain('The answer:');
  });

  test('quit leaves without revealing the answer', async () => {
    const session = drivenSession(scriptedDriver(['quit']));
    const code = await runGame(OFFLINE, { io: session.io });

    expect(code).toBe(0);
    expect(session.answers).toEqual(['quit']);
    expect(session.text()).toContain('You leave the house with the case unsolved.');
    expect(session.text()).not.toContain('The answer:');
  });
});

describe('the notebook', () => {
  test('shows what the seat can prove and nothing it cannot', async () => {
    const session = drivenSession(scriptedDriver(['notes', 'quit']));
    await runGame(OFFLINE, { io: session.io });
    const text = session.text();

    expect(text).toContain('Notebook — turn 1');
    expect(text).toContain('Proven in another hand: (nothing yet)');
    // Before anything has been shown, every card the seat does not hold is open.
    const hand = handFrom(session.lines);
    const open = text.slice(text.indexOf('Suspects still possible: '));
    for (const card of [...SUSPECTS, ...WEAPONS, ...ROOMS]) {
      if (hand.includes(card)) expect(open).not.toContain(`${card},`);
    }
  });
});

describe('with a game master', () => {
  test('narrates in the model\'s words and prints the measured token ledger', async () => {
    const vendor = startFakeVendor((request) => {
      const body = request.body as { messages: { content: string }[] };
      const prompt = body.messages.map((message) => message.content).join('\n');
      if (prompt.includes('Return exactly this JSON shape')) {
        return completionResponse({
          content: JSON.stringify({
            victim: 'Lord Edgemere',
            setting: 'A rain-locked manor',
            intro: 'The clock stopped at nine.',
            suspects: [{ name: 'Miss Scarlett', persona: 'All silk and no answers.' }],
          }),
          model: 'Test-Model',
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        });
      }
      // Narration: one string per numbered line requested.
      const count = (prompt.match(/^\d+\. /gm) ?? []).length;
      return completionResponse({
        content: JSON.stringify(Array.from({ length: count }, (_u, index) => `Narrated line ${index + 1}.`)),
        model: 'Test-Model',
        usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
      });
    });

    try {
      const session = drivenSession(scriptedDriver(['quit']));
      const client = clientFor(vendor.baseUrl);
      await runGame({ seed: 1, players: 3, useLlm: true }, { io: session.io, createClient: () => client });
      const text = session.text();

      expect(text).toContain('Lord Edgemere');
      expect(text).toContain('game master: Test-Model');
      expect(text).toContain('Narrated line 1.');
      // The ledger is read from the responses' own usage objects, per model.
      expect(text).toContain('LLM usage: 2 calls, 160 tokens (130 prompt + 30 completion)');
      expect(text).toContain('  test-model: 2 calls, 160 tokens');
      expect(vendor.requests.length).toBe(2);
    } finally {
      await vendor.stop();
    }
  });

  /**
   * This test used to pin `No LLM calls were made this session.` for an
   * all-failure session. That line was pinned DELIBERATELY, to put the
   * builder's own journaled doubt in front of the panel: the calls WERE made,
   * and a ledger that reports silence hides tokens the vendor may already have
   * charged for. The panel (agy) accepted the finding, so the pinned line is
   * now the failed-attempt count.
   */
  test('a vendor that fails is one line of notice, and the game plays on', async () => {
    const vendor = startFakeVendor(() => errorResponse(500, 'down'));
    try {
      const session = drivenSession(plainPlayer());
      const client = clientFor(vendor.baseUrl, { retryBackoffMs: 1 });
      const code = await runGame(
        { seed: 2, players: 3, useLlm: true },
        { io: session.io, createClient: () => client },
      );
      const text = session.text();

      expect(code).toBe(0);
      expect(text).toContain('the game master is not answering');
      // Said once, however many calls fail.
      expect(session.lines.filter((line) => line.includes('the game master is not answering'))).toHaveLength(1);
      // The canned scenario and the engine's own sentences carry the game.
      expect(text).toContain('The dead: Doctor Alastair Vane');
      expect(text).toContain('── Case closed ──');
      // The breaker opens after the second consecutive failure and says so
      // once, through the loop's own io (panel finding, codex). The dead
      // endpoint is then never called again: a whole game of narration flushes
      // and it stops at the scenario's two exchanges plus the first flush's two.
      expect(session.lines.filter((line) => line.includes('LLM disabled for this session'))).toHaveLength(1);
      expect(vendor.requests).toHaveLength(4);
      // Every call failed: no tokens can be reported, but the attempts are.
      expect(text).not.toContain('No LLM calls were made this session.');
      expect(text).toMatch(/LLM usage: 0 completed calls, \d+ failed attempts?/);
    } finally {
      await vendor.stop();
    }
  }, 30_000);

  /**
   * Panel finding (codex): everything the model says was written to stdout
   * untouched, so a vendor could hand the player's terminal escape sequences to
   * execute — colour, cursor moves back over lines already read, a rewritten
   * window title, an OSC 52 clipboard write.
   *
   * The vendor here is hostile on every channel the game reads: the scenario,
   * the narration and a suspect's answer. Note that the scenario and narration
   * payloads are JSON, so `JSON.stringify` sends each escape as its six-character JSON escape on the
   * wire and they become real control characters only when the game master
   * decodes them — which is why the sanitizing boundary has to sit after that
   * decode, not at the HTTP layer.
   */
  test('a hostile vendor cannot put a terminal escape on the screen', async () => {
    const ESC = String.fromCharCode(0x1b);
    const BEL = String.fromCharCode(0x07);
    const CSI_C1 = String.fromCharCode(0x9b);

    const vendor = startFakeVendor((request) => {
      const body = request.body as { messages: { content: string }[] };
      const prompt = body.messages.map((message) => message.content).join('\n');

      if (prompt.includes('Return exactly this JSON shape')) {
        return completionResponse({
          content: JSON.stringify({
            victim: `Lord ${ESC}[31mEdgemere${ESC}[0m`,
            setting: `A rain-locked manor${ESC}]0;pwned${BEL}`,
            intro: `${CSI_C1}2JThe clock stopped at nine.${ESC}[1;1H`,
            suspects: SUSPECTS.map((suspect) => ({
              name: suspect,
              persona: `${suspect}, sharply drawn.`,
            })),
          }),
          // Even the model id the vendor answers with lands on the screen, in
          // the ledger's per-model row.
          model: `Test-Model${ESC}]0;pwned${BEL}`,
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
      }

      if (prompt.includes('a guest questioned about a death in the house')) {
        return completionResponse({
          content: `${ESC}]0;pwned${BEL}I was on the stairs${ESC}[2J.`,
          model: 'Test-Model',
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
      }

      const count = (prompt.match(/^\d+\. /gm) ?? []).length;
      return completionResponse({
        content: JSON.stringify(
          Array.from({ length: count }, () => `${CSI_C1}2K${ESC}[31mA door closes upstairs.${ESC}[0m`),
        ),
        model: 'Test-Model',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    });

    try {
      const session = drivenSession(
        scriptedDriver(['ask', '1', 'Where were you when the lamps went out?', 'quit']),
      );
      const client = clientFor(vendor.baseUrl);
      const code = await runGame(
        { seed: 1, players: 3, useLlm: true },
        { io: session.io, createClient: () => client },
      );
      const text = session.text();

      const controls = [...text]
        .filter((char) => {
          const code = char.charCodeAt(0);
          if (code === 0x09 || code === 0x0a) return false;
          return code < 0x20 || (code >= 0x7f && code <= 0x9f);
        })
        .map((char) => `0x${char.charCodeAt(0).toString(16)}`);
      console.log('[hostile vendor] control characters on screen ->', controls);

      expect(code).toBe(0);
      expect(controls).toEqual([]);
      expect(text).not.toContain('pwned');
      // Nothing was thrown away with the escapes: the words are all still there.
      expect(text).toContain('The dead: Lord Edgemere');
      expect(text).toContain('A rain-locked manor');
      expect(text).toContain('The clock stopped at nine.');
      expect(text).toContain('A door closes upstairs.');
      expect(text).toContain('I was on the stairs.');
      // Including the vendor-supplied model id in the ledger's own row.
      expect(text).toContain('  test-model: ');
    } finally {
      await vendor.stop();
    }
  }, 30_000);

  /**
   * Panel finding (codex): a successful narration REPLACED the engine's own
   * sentence, so a model that omitted a refutation, or described one that did
   * not happen, was the only account the player got of a fact the rules turn
   * on. ADR-0001 says the model describes and never decides — which cannot hold
   * if the description is the player's only channel to what was decided.
   *
   * The vendor here narrates every beat with the same piece of scenery: it
   * mentions no refutation, and it contradicts the log by insisting nothing was
   * shown. The authoritative lines must be on the screen anyway.
   */
  test('narration that omits and contradicts a refutation cannot hide it', async () => {
    const FLAVOUR = 'The gramophone plays on, and nobody shows anybody anything.';
    const vendor = startFakeVendor((request) => {
      const body = request.body as { messages: { content: string }[] };
      const prompt = body.messages.map((message) => message.content).join('\n');
      if (prompt.includes('Return exactly this JSON shape')) {
        return completionResponse({
          content: JSON.stringify({ victim: 'Lord Edgemere', setting: 'A rain-locked manor' }),
          model: 'Test-Model',
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
      }
      const count = (prompt.match(/^\d+\. /gm) ?? []).length;
      return completionResponse({
        content: JSON.stringify(Array.from({ length: count }, () => FLAVOUR)),
        model: 'Test-Model',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    });

    try {
      const session = drivenSession(plainPlayer());
      const client = clientFor(vendor.baseUrl);
      const code = await runGame(
        { seed: 2, players: 3, useLlm: true },
        { io: session.io, createClient: () => client },
      );
      const text = session.text();
      const lines = session.lines;

      expect(code).toBe(0);
      // The model really was the narrator: this is its voice, all game.
      expect(lines.filter((line) => line.includes(FLAVOUR)).length).toBeGreaterThan(5);
      expect(text).not.toContain('the game master is not answering');

      // A refutation happened, and the ENGINE said so — in its own words, on a
      // line of its own, next to the model's contradiction of it.
      const refutations = lines.filter((line) =>
        /refutes .*'s suggestion with a card shown in private\./.test(line),
      );
      console.log('[authoritative] refutation lines ->', refutations.slice(0, 3));
      expect(refutations.length).toBeGreaterThan(0);
      // And so was the card the player was shown, and the game's own ending.
      expect(text).toMatch(/ {2}p\d shows you the /);
      expect(text).toMatch(/ {2}(p\d wins: |The game ends unsolved\.)/);

      // Flavour events are still told in the model's words alone: the engine's
      // sentence for a roll or a move is nowhere on the screen.
      expect(text).not.toMatch(/ {2}p\d rolls a \d\./);
      expect(text).not.toMatch(/ {2}p\d moves \d+ steps? from /);
    } finally {
      await vendor.stop();
    }
  }, 60_000);

  test('a client that cannot even be built is a notice, not a crash', async () => {
    const session = drivenSession(scriptedDriver(['quit']));
    const code = await runGame(
      { seed: 1, players: 3, useLlm: true },
      {
        io: session.io,
        createClient: () => {
          throw new Error('Missing POE_API_KEY.');
        },
      },
    );

    expect(code).toBe(0);
    expect(session.text()).toContain('(no game master: Missing POE_API_KEY.)');
    expect(session.text()).toContain('playing offline');
    expect(session.text()).toContain('No LLM calls were made this session.');
  });
});

describe('resolveChoice', () => {
  const options = [
    { key: 'roll', label: 'roll', value: 'roll' },
    { key: 'notes', label: 'notes', value: 'notes' },
    { key: 'quit', label: 'quit', value: 'quit' },
  ];

  test.each([
    ['1', 'roll'],
    ['3', 'quit'],
    ['roll', 'roll'],
    ['ROLL', 'roll'],
    ['  quit  ', 'quit'],
    ['q', 'quit'],
  ])('%s resolves to %s', (answer, expected) => {
    expect(resolveChoice(answer, options)?.value).toBe(expected);
  });

  test.each([['0'], ['4'], [''], ['banana'], ['zz']])('%s resolves to nothing', (answer) => {
    expect(resolveChoice(answer, options)).toBeNull();
  });

  test('an ambiguous prefix resolves to nothing rather than to a guess', () => {
    const ambiguous = [...options, { key: 'nudge', label: 'nudge', value: 'nudge' }];
    expect(resolveChoice('n', ambiguous)).toBeNull();
    expect(resolveChoice('no', ambiguous)?.value).toBe('notes');
  });
});
