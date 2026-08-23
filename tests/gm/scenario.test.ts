/**
 * The scenario builder: one LLM call at setup that dresses a mechanically
 * standard game in fiction.
 *
 * The hard constraint under test is PRODUCT.md 4 / ADR-0001 — game legality
 * NEVER depends on LLM output. Every failure mode below (transport error,
 * non-JSON body, JSON of the wrong shape, a provider that rejects
 * `response_format`) must still leave a complete, playable scenario.
 */

import { describe, expect, test } from 'bun:test';

import { SUSPECTS } from '../../src/engine/cards.ts';
import { CANNED_SCENARIO, parseScenario, requestScenario } from '../../src/gm/scenario.ts';
import { completionResponse, errorResponse, startFakeVendor } from '../llm/fake-vendor.ts';
import { clientFor, promptTextOf } from './support.ts';

const GOOD_SCENARIO = JSON.stringify({
  victim: 'Lady Ottoline Vance',
  setting: 'A rain-locked estate on the Cornish coast, autumn 1937.',
  intro: 'The house has not slept since the scream.',
  suspects: SUSPECTS.map((suspect) => ({ name: suspect, persona: `${suspect} is unbearably calm.` })),
});

describe('the happy path', () => {
  test('a well-formed JSON reply becomes the session scenario', async () => {
    const vendor = startFakeVendor(() =>
      completionResponse({
        content: GOOD_SCENARIO,
        model: 'Scenario-Model',
        usage: { prompt_tokens: 120, completion_tokens: 300, total_tokens: 420 },
      }),
    );
    try {
      const client = clientFor(vendor.baseUrl);
      const scenario = await requestScenario(client);
      console.log('[scenario ok] ->', scenario);

      expect(scenario.source).toBe('llm');
      expect(scenario.victim).toBe('Lady Ottoline Vance');
      expect(scenario.setting).toContain('Cornish');
      expect(scenario.intro).toContain('scream');
      for (const suspect of SUSPECTS) {
        expect(scenario.personas[suspect]).toContain(suspect);
      }

      // Exactly one call, and the token figures land in the shared ledger.
      expect(vendor.requests).toHaveLength(1);
      expect(client.usage.total_tokens).toBe(420);
      expect(client.usage.byModel['scenario-model']?.calls).toBe(1);
    } finally {
      await vendor.stop();
    }
  });

  test('the request asks for a JSON object and names every card in the deck', async () => {
    const vendor = startFakeVendor(() => completionResponse({ content: GOOD_SCENARIO }));
    try {
      await requestScenario(clientFor(vendor.baseUrl));
      const request = vendor.requests[0]!;
      console.log('[scenario request] ->', request.body);

      expect((request.body as { response_format?: unknown }).response_format).toEqual({
        type: 'json_object',
      });
      const prompt = promptTextOf(request);
      for (const suspect of SUSPECTS) expect(prompt).toContain(suspect);
    } finally {
      await vendor.stop();
    }
  });
});

describe('degradation — the game stays playable', () => {
  test('a transport failure yields the canned scenario', async () => {
    const vendor = startFakeVendor(() => errorResponse(500, 'vendor on fire'));
    try {
      const scenario = await requestScenario(clientFor(vendor.baseUrl));
      console.log('[scenario failed] source ->', scenario.source);

      expect(scenario).toEqual(CANNED_SCENARIO);
      expect(scenario.source).toBe('fallback');
      // Complete enough to play: a persona for every suspect in the deck.
      for (const suspect of SUSPECTS) {
        expect(scenario.personas[suspect].length).toBeGreaterThan(0);
      }
    } finally {
      await vendor.stop();
    }
  });

  test('a reply that is not JSON yields the canned scenario', async () => {
    const vendor = startFakeVendor(() =>
      completionResponse({ content: 'Certainly! Here is your murder mystery: ...' }),
    );
    try {
      const scenario = await requestScenario(clientFor(vendor.baseUrl));
      expect(scenario).toEqual(CANNED_SCENARIO);
    } finally {
      await vendor.stop();
    }
  });

  test('JSON of the wrong shape degrades field by field rather than all at once', async () => {
    const vendor = startFakeVendor(() =>
      completionResponse({
        content: JSON.stringify({
          victim: 'Sir Rowland Ashby',
          setting: 42,
          suspects: [
            { name: 'Mrs. Peacock', persona: 'Furious about the seating plan.' },
            { name: 'Nobody At All', persona: 'Not in this deck.' },
            'not an object',
          ],
        }),
      }),
    );
    try {
      const scenario = await requestScenario(clientFor(vendor.baseUrl));
      console.log('[scenario ragged] ->', scenario);

      expect(scenario.victim).toBe('Sir Rowland Ashby');
      expect(scenario.setting).toBe(CANNED_SCENARIO.setting); // 42 is not a setting
      expect(scenario.intro).toBe(CANNED_SCENARIO.intro);
      expect(scenario.personas['Mrs. Peacock']).toBe('Furious about the seating plan.');
      expect(scenario.personas['Professor Plum']).toBe(CANNED_SCENARIO.personas['Professor Plum']);
    } finally {
      await vendor.stop();
    }
  });

  test('a provider that rejects response_format is retried once without it', async () => {
    const vendor = startFakeVendor((request, index) => {
      const hasFormat = (request.body as { response_format?: unknown }).response_format !== undefined;
      if (index === 0) {
        expect(hasFormat).toBe(true);
        return errorResponse(400, 'unknown parameter: response_format');
      }
      expect(hasFormat).toBe(false);
      return completionResponse({ content: GOOD_SCENARIO });
    });
    try {
      const scenario = await requestScenario(clientFor(vendor.baseUrl));
      console.log('[scenario retry] requests ->', vendor.requests.length);

      expect(vendor.requests).toHaveLength(2);
      expect(scenario.source).toBe('llm');
      expect(scenario.victim).toBe('Lady Ottoline Vance');
    } finally {
      await vendor.stop();
    }
  });

  test('a 5xx is not retried without response_format — the transport already retried it', async () => {
    const vendor = startFakeVendor(() => errorResponse(503, 'try later'));
    try {
      const scenario = await requestScenario(clientFor(vendor.baseUrl));
      // The client itself retries a 5xx once: two requests, then the canned scenario.
      expect(vendor.requests).toHaveLength(2);
      expect(scenario.source).toBe('fallback');
    } finally {
      await vendor.stop();
    }
  });
});

describe('parseScenario', () => {
  test('reads a fenced JSON block, which is what models actually send', () => {
    const parsed = parseScenario(['```json', GOOD_SCENARIO, '```'].join('\n'));
    expect(parsed?.victim).toBe('Lady Ottoline Vance');
  });

  test('returns null for anything that is not a JSON object', () => {
    expect(parseScenario('')).toBeNull();
    expect(parseScenario('[1, 2, 3]')).toBeNull();
    expect(parseScenario('nope')).toBeNull();
  });
});
