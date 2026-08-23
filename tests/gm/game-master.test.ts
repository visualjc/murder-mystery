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
import { playerView } from '../../src/engine/view.ts';
import { CANNED_SCENARIO } from '../../src/gm/scenario.ts';
import { GameMaster, formatUsageLedger } from '../../src/gm/index.ts';
import { completionResponse, errorResponse, startFakeVendor } from '../llm/fake-vendor.ts';
import { arrangedGame, standingInRoom } from '../engine/helpers.ts';
import { clientFor } from './support.ts';

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
      const lines = await master.narrate([view.events[0]!]);
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

describe('formatUsageLedger', () => {
  test('renders the session total and a line per model', async () => {
    const vendor = roleVendor();
    try {
      const master = new GameMaster(clientFor(vendor.baseUrl), { models: MODELS });
      await master.openScenario();
      await master.narrate([]);
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

  test('an unused session says so rather than printing an empty table', () => {
    const lines = formatUsageLedger({
      calls: 0,
      callsWithUsage: 0,
      callsWithoutUsage: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      byModel: {},
    });
    expect(lines).toEqual(['No LLM calls were made this session.']);
  });

  test('calls the provider did not report usage for are named, not hidden', () => {
    const lines = formatUsageLedger({
      calls: 3,
      callsWithUsage: 2,
      callsWithoutUsage: 1,
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      byModel: { 'some-model': { calls: 2, prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
    });
    console.log('[ledger partial]\n' + lines.join('\n'));
    expect(lines.join('\n')).toContain('1 call reported no usage');
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
