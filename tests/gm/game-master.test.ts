/**
 * The game master as one object over ONE shared chat client.
 *
 * The point of the shared client is token accounting (PRODUCT.md hard
 * constraint 6, orchestrator resolution 5rwbt08h — token-count attribution v1):
 * scenario, narration and Q&A may run on different models, and the session
 * ledger has to attribute each one's tokens to the model that spent them.
 */

import { describe, expect, test } from 'bun:test';

import { SUSPECTS } from '../../src/engine/cards.ts';
import { makeSuggestion } from '../../src/engine/actions.ts';
import { describeEvent, playerView } from '../../src/engine/view.ts';
import { CANNED_SCENARIO } from '../../src/gm/scenario.ts';
import { GameMaster, formatUsageLedger } from '../../src/gm/index.ts';
import { completionResponse, errorResponse, startFakeVendor } from '../llm/fake-vendor.ts';
import { arrangedGame, standingInRoom } from '../engine/helpers.ts';
import { clientFor, promptTextOf } from './support.ts';

const MODELS = { scenario: 'Scenario-Model', narration: 'Narration-Model', qa: 'Qa-Model' };

/** One vendor answering all three roles, keyed on the model the request names. */
function roleVendor() {
  return startFakeVendor((request) => {
    const model = String((request.body as { model?: unknown }).model ?? '');
    if (model === MODELS.scenario) {
      return completionResponse({
        content: JSON.stringify({
          victim: 'Lady Ottoline Vance',
          setting: 'A rain-locked estate.',
          intro: 'Nobody has slept.',
          suspects: SUSPECTS.map((suspect) => ({ name: suspect, persona: `${suspect}, sharply drawn.` })),
        }),
        model,
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      });
    }
    if (model === MODELS.narration) {
      return completionResponse({
        content: JSON.stringify(['A door closes somewhere upstairs.']),
        model,
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    }
    return completionResponse({
      content: 'I was where I always am, and I resent the implication.',
      model,
      usage: { prompt_tokens: 20, completion_tokens: 7, total_tokens: 27 },
    });
  });
}

describe('one client, one ledger', () => {
  test('every call goes through the shared client and is attributed to its model', async () => {
    const vendor = roleVendor();
    try {
      const client = clientFor(vendor.baseUrl);
      const master = new GameMaster(client, { models: MODELS });
      const state = standingInRoom(arrangedGame(), 'p1', 'Library');
      const view = playerView(state, 'p1');

      const scenario = await master.openScenario();
      const lines = await master.narrate(view, [view.events[0]!]);
      const answer = await master.ask(view, 'Colonel Mustard', 'Who let you in?');
      console.log('[game master] usage ->', client.usage);

      expect(scenario.source).toBe('llm');
      expect(lines).toHaveLength(1);
      expect(answer.source).toBe('llm');

      const usage = master.usage;
      expect(usage.calls).toBe(3);
      expect(usage.total_tokens).toBe(300 + 15 + 27);
      expect(usage.byModel['scenario-model']).toEqual({
        calls: 1,
        prompt_tokens: 100,
        completion_tokens: 200,
        total_tokens: 300,
      });
      expect(usage.byModel['narration-model']?.total_tokens).toBe(15);
      expect(usage.byModel['qa-model']?.total_tokens).toBe(27);
      expect(usage).toEqual(client.usage);
    } finally {
      await vendor.stop();
    }
  });

  test('the scenario is generated once and reused for the session', async () => {
    const vendor = roleVendor();
    try {
      const master = new GameMaster(clientFor(vendor.baseUrl), { models: MODELS });
      const first = await master.openScenario();
      const second = await master.openScenario();

      expect(second).toBe(first);
      expect(vendor.requests).toHaveLength(1);
      expect(master.scenario).toBe(first);
    } finally {
      await vendor.stop();
    }
  });

  test('with no scenario opened, the canned one is used and play continues', async () => {
    const vendor = startFakeVendor(() => errorResponse(500, 'down'));
    try {
      const master = new GameMaster(clientFor(vendor.baseUrl));
      const view = playerView(standingInRoom(arrangedGame(), 'p1', 'Library'), 'p1');
      const answer = await master.ask(view, 'Mrs. White', 'Did you hear anything?');

      expect(master.scenario).toBeNull();
      expect(answer.source).toBe('fallback');
      expect(answer.text).toContain('Mrs. White');
      // The attempt was real — a request and the transport's single 5xx retry —
      // but the ledger counts COMPLETED responses, and a failure has no `usage`
      // object to report. Nothing is invented to fill the gap.
      expect(vendor.requests).toHaveLength(2);
      expect(master.usage.calls).toBe(0);
      expect(master.usage.total_tokens).toBe(0);
    } finally {
      await vendor.stop();
    }
  });
});

/**
 * Panel finding (codex): before this, a game master whose endpoint had died
 * kept calling it — every narration flush and every question paid the full
 * timeout again, once per turn, for a reply that was never coming.
 */
describe('the circuit breaker', () => {
  test('two consecutive failures switch the session offline: the vendor is never called again', async () => {
    const vendor = startFakeVendor(() => errorResponse(500, 'down'));
    try {
      const notices: string[] = [];
      const master = new GameMaster(clientFor(vendor.baseUrl, { retryBackoffMs: 1 }), {
        onNotice: (text) => notices.push(text),
      });
      const view = playerView(standingInRoom(arrangedGame(), 'p1', 'Library'), 'p1');

      const scenario = await master.openScenario(); // failure 1
      const firstLines = await master.narrate(view, [view.events[0]!]); // failure 2 — opens
      const requestsWhenOpened = vendor.requests.length;
      console.log('[breaker] requests when opened ->', requestsWhenOpened, 'notices ->', notices);

      expect(master.llmDisabled).toBe(true);
      expect(requestsWhenOpened).toBeGreaterThan(0);

      // Everything after this is offline text, and NOTHING reaches the vendor.
      const laterLines = await master.narrate(view, [view.events[0]!]);
      const answer = await master.ask(view, 'Colonel Mustard', 'Where were you?');
      const secondAnswer = await master.ask(view, 'Mrs. White', 'And you?');

      expect(vendor.requests).toHaveLength(requestsWhenOpened);
      expect(scenario).toBe(CANNED_SCENARIO);
      expect(firstLines.every((line) => line.source === 'fallback')).toBe(true);
      expect(laterLines).toHaveLength(1);
      expect(laterLines[0]?.source).toBe('fallback');
      expect(answer.source).toBe('fallback');
      expect(secondAnswer.source).toBe('fallback');

      // Said exactly once, however many calls are made afterwards.
      expect(notices).toEqual(['LLM disabled for this session after repeated failures — continuing offline']);
      // The ledger records what was spent before the breaker opened and stops.
      expect(master.usage.failures).toBe(2);
      expect(master.usage.attempts).toBe(requestsWhenOpened);
    } finally {
      await vendor.stop();
    }
  });

  test('a single failure followed by a success does not open the breaker', async () => {
    let failing = true;
    const vendor = startFakeVendor(() =>
      failing
        ? errorResponse(500, 'a blip')
        : completionResponse({ content: JSON.stringify(['A door closes somewhere upstairs.']) }),
    );
    try {
      const notices: string[] = [];
      const master = new GameMaster(clientFor(vendor.baseUrl, { retryBackoffMs: 1 }), {
        onNotice: (text) => notices.push(text),
      });
      const view = playerView(standingInRoom(arrangedGame(), 'p1', 'Library'), 'p1');
      const turn = [view.events[0]!];

      const failed = await master.narrate(view, turn);
      failing = false;
      const recovered = await master.narrate(view, turn);
      failing = true;
      const failedAgain = await master.narrate(view, turn);
      failing = false;
      const stillReaching = await master.narrate(view, turn);
      console.log('[breaker transient] requests ->', vendor.requests.length, 'notices ->', notices);

      expect(failed[0]?.source).toBe('fallback');
      expect(recovered[0]?.source).toBe('llm');
      expect(failedAgain[0]?.source).toBe('fallback');
      // The success reset the count, so the second failure is a first failure
      // again — the vendor is still being asked.
      expect(stillReaching[0]?.source).toBe('llm');
      expect(master.llmDisabled).toBe(false);
      expect(notices).toEqual([]);
      // 2 (failure + retry) + 1 + 2 + 1
      expect(vendor.requests).toHaveLength(6);
    } finally {
      await vendor.stop();
    }
  });
});

describe('narration is scoped to the player it is for', () => {
  test('raw turn events handed to the game master are filtered to the viewer', async () => {
    // p2 suggests; p3 shows p2 a card. p1 may know only that it happened.
    const state = makeSuggestion(standingInRoom(arrangedGame(), 'p2', 'Kitchen'), {
      suspect: 'Reverend Green',
      weapon: 'Dagger',
    });
    const shown = state.events.find((event) => event.type === 'refutation-card-shown')!;
    const refuted = state.events.find((event) => event.type === 'suggestion-refuted')!;

    const vendor = startFakeVendor(() =>
      completionResponse({ content: JSON.stringify(['Something passes between them.']) }),
    );
    try {
      const master = new GameMaster(clientFor(vendor.baseUrl));
      // The whole RAW log, exactly as a careless caller would pass it.
      const lines = await master.narrate(playerView(state, 'p1'), state.events);
      const prompt = promptTextOf(vendor.requests[0]!);
      console.log('[gm narrate viewer] ->', prompt);

      expect(prompt).not.toContain(describeEvent(shown));
      expect(prompt).toContain(describeEvent(refuted));
      expect(lines.some((line) => line.event === shown)).toBe(false);
      expect(lines.some((line) => line.event === refuted)).toBe(true);
    } finally {
      await vendor.stop();
    }
  });
});

describe('formatUsageLedger', () => {
  test('renders the session total and a line per model', async () => {
    const vendor = roleVendor();
    try {
      const master = new GameMaster(clientFor(vendor.baseUrl), { models: MODELS });
      const view = playerView(standingInRoom(arrangedGame(), 'p1', 'Library'), 'p1');
      await master.openScenario();
      await master.narrate(view, []);
      const lines = formatUsageLedger(master.usage);
      console.log('[ledger]\n' + lines.join('\n'));

      expect(lines.join('\n')).toContain('scenario-model');
      expect(lines.join('\n')).toContain('300');
      // An empty turn made no call, so only the scenario is accounted for.
      expect(lines.some((line) => line.includes('1 call'))).toBe(true);
    } finally {
      await vendor.stop();
    }
  });

  test('a session that never attempted a call says so rather than printing an empty table', () => {
    const lines = formatUsageLedger({
      calls: 0,
      attempts: 0,
      failures: 0,
      callsWithUsage: 0,
      callsWithoutUsage: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      byModel: {},
    });
    expect(lines).toEqual(['No LLM calls were made this session.']);
  });

  /**
   * Panel finding (agy), and the gap the builder journaled against itself: a
   * session where every call failed used to print "No LLM calls were made",
   * which is false — the requests were made, and the vendor may well have
   * charged for them. Silence about a failed attempt is not honesty.
   */
  test('a session where every call failed reports the failed attempts, not silence', () => {
    const lines = formatUsageLedger({
      calls: 0,
      attempts: 4,
      failures: 3,
      callsWithUsage: 0,
      callsWithoutUsage: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      byModel: {},
    });
    console.log('[ledger all-failure]\n' + lines.join('\n'));
    expect(lines.join('\n')).toContain('0 completed calls, 3 failed attempts');
    expect(lines.join('\n')).not.toContain('No LLM calls were made');
  });

  test('failed attempts alongside completed calls are named on the total line', () => {
    const lines = formatUsageLedger({
      calls: 3,
      attempts: 5,
      failures: 1,
      callsWithUsage: 3,
      callsWithoutUsage: 0,
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      byModel: { 'some-model': { calls: 3, prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
    });
    console.log('[ledger with failures]\n' + lines.join('\n'));
    expect(lines[0]).toContain('3 calls, 1 failed attempt,');
  });

  test('calls the provider did not report usage for are named, not hidden', () => {
    const lines = formatUsageLedger({
      calls: 3,
      attempts: 3,
      failures: 0,
      callsWithUsage: 2,
      callsWithoutUsage: 1,
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      byModel: { 'some-model': { calls: 2, prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
    });
    console.log('[ledger partial]\n' + lines.join('\n'));
    expect(lines.join('\n')).toContain('1 call reported no usage');
    // No failures: the total line stays exactly as it was.
    expect(lines[0]).toContain('LLM usage: 3 calls, 15 tokens');
  });
});

describe('the canned scenario is a complete scenario', () => {
  test('it names a victim, a setting, an intro and every suspect', () => {
    expect(CANNED_SCENARIO.victim.length).toBeGreaterThan(0);
    expect(CANNED_SCENARIO.setting.length).toBeGreaterThan(0);
    expect(CANNED_SCENARIO.intro.length).toBeGreaterThan(0);
    expect(Object.keys(CANNED_SCENARIO.personas).sort()).toEqual([...SUSPECTS].sort());
    expect(CANNED_SCENARIO.source).toBe('fallback');
  });
});
