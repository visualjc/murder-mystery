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

import { ROOMS, SUSPECTS, WEAPONS, type Card, type SolutionTriple } from '../../src/engine/cards.ts';
import type { PlayerId } from '../../src/engine/types.ts';
import { CANNED_SCENARIO, parseScenario, requestScenario } from '../../src/gm/scenario.ts';
import { completionResponse, errorResponse, startFakeVendor } from '../llm/fake-vendor.ts';
import { FIXTURE_CASE_FILE, FIXTURE_HANDS, arrangedGame } from '../engine/helpers.ts';
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

/**
 * The scenario call is the ONLY LLM call made before a card has been dealt, and
 * it is the one place a "just give the model some context" reflex would put the
 * case file into a prompt. `requestScenario` takes no state parameter at all,
 * and these tests pin that structurally rather than trusting the signature to
 * stay that way.
 *
 * It cannot be pinned by asserting the triple's card NAMES are absent: the
 * prompt has to name the deck for the model to invent fiction about it. The
 * property that matters is that it names the deck UNIFORMLY — every card once,
 * none singled out — and that the request is byte-identical across games that
 * disagree about everything.
 */
describe('the scenario request carries no game state', () => {
  /** A second deal that shares no case-file card and no hand with the fixture. */
  const OTHER_CASE_FILE: SolutionTriple = {
    suspect: 'Mrs. White',
    weapon: 'Candlestick',
    room: 'Library',
  };
  const OTHER_HANDS: Record<PlayerId, Card[]> = {
    p1: ['Miss Scarlett', 'Colonel Mustard', 'Dagger', 'Kitchen', 'Ballroom', 'Conservatory'],
    p2: ['Reverend Green', 'Mrs. Peacock', 'Lead Pipe', 'Dining Room', 'Billiard Room', 'Lounge'],
    p3: ['Professor Plum', 'Revolver', 'Rope', 'Wrench', 'Hall', 'Study'],
  };

  function occurrences(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
  }

  test('two games that agree on nothing produce byte-identical requests', async () => {
    // Both are real, playable games whose case files and hands differ entirely.
    const first = arrangedGame();
    const second = arrangedGame({ caseFile: OTHER_CASE_FILE, hands: OTHER_HANDS });
    expect(first.caseFile).not.toEqual(second.caseFile);
    expect(first.players[0]!.hand).not.toEqual(second.players[0]!.hand);

    const vendor = startFakeVendor(() => completionResponse({ content: GOOD_SCENARIO }));
    try {
      await requestScenario(clientFor(vendor.baseUrl));
      await requestScenario(clientFor(vendor.baseUrl));
      const [one, two] = vendor.requests;

      expect(JSON.stringify(two!.body)).toBe(JSON.stringify(one!.body));
    } finally {
      await vendor.stop();
    }
  });

  test('the deck is enumerated uniformly — every card once, none singled out', async () => {
    const vendor = startFakeVendor(() => completionResponse({ content: GOOD_SCENARIO }));
    try {
      await requestScenario(clientFor(vendor.baseUrl));
      const prompt = promptTextOf(vendor.requests[0]!);
      console.log('[scenario state-free] prompt ->', prompt);

      const counts = ([...SUSPECTS, ...WEAPONS, ...ROOMS] as Card[]).map((card) => [
        card,
        occurrences(prompt, card),
      ]);
      console.log('[scenario state-free] card counts ->', counts);
      // The case file's own cards are named neither more nor less than any
      // other card: the prompt distinguishes nothing about this game.
      expect(counts.filter(([, count]) => count !== 1)).toEqual([]);
      for (const card of [FIXTURE_CASE_FILE.suspect, FIXTURE_CASE_FILE.weapon, FIXTURE_CASE_FILE.room]) {
        expect(occurrences(prompt, card)).toBe(1);
      }
    } finally {
      await vendor.stop();
    }
  });

  test('no seat, no hand and no case-file grouping reaches the vendor', async () => {
    const vendor = startFakeVendor(() => completionResponse({ content: GOOD_SCENARIO }));
    try {
      await requestScenario(clientFor(vendor.baseUrl));
      const body = JSON.stringify(vendor.requests[0]!.body);

      for (const seat of Object.keys(FIXTURE_HANDS)) expect(body).not.toContain(seat);
      for (const term of ['caseFile', 'case file', 'hand', 'solution', 'murderer is']) {
        expect(body.toLowerCase()).not.toContain(term.toLowerCase());
      }
      // A hand is six named cards in a row; no such run exists in the prompt.
      for (const hand of Object.values(FIXTURE_HANDS)) {
        expect(body).not.toContain(hand.join(', '));
      }
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
