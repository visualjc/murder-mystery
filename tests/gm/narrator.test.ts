/**
 * The narrator: engine events in, prose out, one batched call per turn.
 *
 * Narration is discardable by construction (CONTEXT.md, ADR-0001). Every test
 * that breaks the model asserts the engine's own `describeEvent` sentence is
 * shown VERBATIM instead, so a dead vendor costs flavor and nothing else.
 */

import { describe, expect, test } from 'bun:test';

import { makeSuggestion, rollDice } from '../../src/engine/actions.ts';
import { createGame } from '../../src/engine/setup.ts';
import { describeEvent, visibleEvents } from '../../src/engine/view.ts';
import type { GameEvent, GameState } from '../../src/engine/types.ts';
import { CANNED_SCENARIO } from '../../src/gm/scenario.ts';
import { CRITICAL_EVENTS, narrateEvents } from '../../src/gm/narrator.ts';
import { completionResponse, errorResponse, startFakeVendor } from '../llm/fake-vendor.ts';
import { arrangedGame, standingInRoom } from '../engine/helpers.ts';
import { clientFor, promptTextOf } from './support.ts';

/** A real turn's worth of real events, seen by p1. */
function turnEvents(): GameEvent[] {
  const start = createGame({ seed: 'narrate', playerCount: 3 });
  const rolled = rollDice(start);
  const suggested = makeSuggestion(standingInRoom(arrangedGame(), 'p1', 'Library'), {
    suspect: 'Mrs. Peacock',
    weapon: 'Revolver',
  });
  return [...visibleEvents(rolled, 'p1'), ...visibleEvents(suggested, 'p1')].slice(0, 6);
}

/**
 * A refutation between two OTHER players: p2 suggests, p3 holds exactly one
 * matching card and shows it to p2 alone. p1 is entitled to know that a
 * refutation happened, and to nothing else about it.
 */
function refutationBetweenOthers(): GameState {
  return makeSuggestion(standingInRoom(arrangedGame(), 'p2', 'Kitchen'), {
    suspect: 'Reverend Green',
    weapon: 'Dagger',
  });
}

describe('narration', () => {
  test('one call per turn covers the whole batch of events', async () => {
    const events = turnEvents();
    const vendor = startFakeVendor(() =>
      completionResponse({
        content: JSON.stringify(events.map((_event, index) => `Line ${index} in a velvet voice.`)),
        usage: { prompt_tokens: 80, completion_tokens: 60, total_tokens: 140 },
      }),
    );
    try {
      const client = clientFor(vendor.baseUrl);
      const lines = await narrateEvents(client, { scenario: CANNED_SCENARIO, viewer: 'p1', events });
      console.log('[narration] lines ->', lines.map((line) => line.text));

      expect(vendor.requests).toHaveLength(1);
      expect(lines).toHaveLength(events.length);
      lines.forEach((line, index) => {
        expect(line.source).toBe('llm');
        expect(line.text).toBe(`Line ${index} in a velvet voice.`);
        expect(line.event).toBe(events[index]!);
      });

      // The prompt carries the engine's own account of each event, so the model
      // is describing facts rather than inventing them.
      const prompt = promptTextOf(vendor.requests[0]!);
      for (const event of events) expect(prompt).toContain(describeEvent(event));
      expect(client.usage.total_tokens).toBe(140);
    } finally {
      await vendor.stop();
    }
  });

  test('a transport failure falls back to describeEvent, verbatim', async () => {
    const events = turnEvents();
    const vendor = startFakeVendor(() => errorResponse(500, 'no narrator today'));
    try {
      const lines = await narrateEvents(clientFor(vendor.baseUrl), {
        scenario: CANNED_SCENARIO,
        viewer: 'p1',
        events,
      });
      console.log('[narration failed] ->', lines.map((line) => line.text));

      expect(lines).toHaveLength(events.length);
      lines.forEach((line, index) => {
        expect(line.source).toBe('fallback');
        expect(line.text).toBe(describeEvent(events[index]!));
      });
    } finally {
      await vendor.stop();
    }
  });

  test('a reply that is not a JSON array falls back for every event', async () => {
    const events = turnEvents();
    const vendor = startFakeVendor(() =>
      completionResponse({ content: 'The night was dark and full of nonsense.' }),
    );
    try {
      const lines = await narrateEvents(clientFor(vendor.baseUrl), {
        scenario: CANNED_SCENARIO,
        viewer: 'p1',
        events,
      });
      expect(lines.every((line) => line.source === 'fallback')).toBe(true);
      expect(lines.map((line) => line.text)).toEqual(events.map(describeEvent));
    } finally {
      await vendor.stop();
    }
  });

  test('a short or ragged array falls back only for the entries it missed', async () => {
    const events = turnEvents();
    const vendor = startFakeVendor(() =>
      completionResponse({ content: JSON.stringify(['A hush falls.', '', 17]) }),
    );
    try {
      const lines = await narrateEvents(clientFor(vendor.baseUrl), {
        scenario: CANNED_SCENARIO,
        viewer: 'p1',
        events,
      });
      console.log('[narration ragged] ->', lines.map((line) => [line.source, line.text]));

      expect(lines[0]!.text).toBe('A hush falls.');
      expect(lines[0]!.source).toBe('llm');
      // An empty string and a number are not narration.
      expect(lines[1]!.text).toBe(describeEvent(events[1]!));
      expect(lines[2]!.text).toBe(describeEvent(events[2]!));
      for (let index = 3; index < events.length; index += 1) {
        expect(lines[index]!.source).toBe('fallback');
      }
    } finally {
      await vendor.stop();
    }
  });

  test('an empty turn costs nothing — no call is made at all', async () => {
    const vendor = startFakeVendor(() => completionResponse({ content: '[]' }));
    try {
      const client = clientFor(vendor.baseUrl);
      const lines = await narrateEvents(client, { scenario: CANNED_SCENARIO, viewer: 'p1', events: [] });
      expect(lines).toEqual([]);
      expect(vendor.requests).toHaveLength(0);
      expect(client.usage.calls).toBe(0);
    } finally {
      await vendor.stop();
    }
  });
});

/**
 * Defense in depth. The caller says WHOSE narration this is; the narrator
 * applies the engine's own visibility rule to whatever it was handed. A caller
 * that slices raw turn events off `state.events` — the obvious mistake — cannot
 * put another player's private card into a prompt.
 */
describe('the narrator filters for its viewer', () => {
  test('a private card shown between two other players never reaches the vendor', async () => {
    const state = refutationBetweenOthers();
    const refuted = state.events.find((event) => event.type === 'suggestion-refuted')!;
    const shown = state.events.find((event) => event.type === 'refutation-card-shown')!;

    // The private event really does name a card, and p1 really may not see it.
    expect(describeEvent(shown)).toContain('Reverend Green');
    expect(visibleEvents(state, 'p1')).not.toContain(shown);
    expect(visibleEvents(state, 'p2')).toContain(shown);

    const vendor = startFakeVendor(() =>
      completionResponse({ content: JSON.stringify(['A card changes hands in silence.']) }),
    );
    try {
      // The careless caller: the tail of the RAW log, unfiltered, for p1.
      const lines = await narrateEvents(clientFor(vendor.baseUrl), {
        scenario: CANNED_SCENARIO,
        viewer: 'p1',
        events: [refuted, shown],
      });
      const prompt = promptTextOf(vendor.requests[0]!);
      console.log('[narration viewer-filtered] prompt ->', prompt);

      expect(prompt).not.toContain('Reverend Green');
      // What p1 may see still narrates — the filter drops, it does not mute.
      expect(prompt).toContain(describeEvent(refuted));
      expect(lines).toHaveLength(1);
      expect(lines[0]!.event).toBe(refuted);
      expect(lines[0]!.text).toBe('A card changes hands in silence.');
    } finally {
      await vendor.stop();
    }
  });

  test('the player the card was shown to still hears about it', async () => {
    const state = refutationBetweenOthers();
    const shown = state.events.find((event) => event.type === 'refutation-card-shown')!;
    const vendor = startFakeVendor(() => errorResponse(500, 'no narrator today'));
    try {
      const lines = await narrateEvents(clientFor(vendor.baseUrl), {
        scenario: CANNED_SCENARIO,
        viewer: 'p2',
        events: [shown],
      });
      console.log('[narration viewer p2] ->', lines.map((line) => line.text));

      expect(lines).toHaveLength(1);
      expect(lines[0]!.text).toBe(describeEvent(shown));
      expect(lines[0]!.text).toContain('Reverend Green');
    } finally {
      await vendor.stop();
    }
  });

  test('a turn with nothing visible to the viewer costs no call at all', async () => {
    const state = refutationBetweenOthers();
    const shown = state.events.find((event) => event.type === 'refutation-card-shown')!;
    const vendor = startFakeVendor(() => completionResponse({ content: '["never asked"]' }));
    try {
      const client = clientFor(vendor.baseUrl);
      const lines = await narrateEvents(client, {
        scenario: CANNED_SCENARIO,
        viewer: 'p1',
        events: [shown],
      });
      expect(lines).toEqual([]);
      expect(vendor.requests).toHaveLength(0);
      expect(client.usage.calls).toBe(0);
    } finally {
      await vendor.stop();
    }
  });
});

/**
 * The set the loop consults before it lets narration stand alone. It is pinned
 * here because shrinking it is exactly how the panel's finding (codex) would
 * come back: an event quietly dropped from this list becomes an event the
 * player only ever hears about from the model.
 */
describe('CRITICAL_EVENTS', () => {
  test('names every moment a player deduces from, and nothing that is only scenery', () => {
    console.log('[critical events] ->', [...CRITICAL_EVENTS].sort());
    expect([...CRITICAL_EVENTS].sort()).toEqual([
      'accusation-made',
      'game-over',
      'player-eliminated',
      'refutation-card-shown',
      'suggestion-refuted',
      'suggestion-unrefuted',
    ]);
    for (const scenery of ['rolled', 'moved', 'secret-passage', 'token-relocated', 'turn-started'] as const) {
      expect(CRITICAL_EVENTS.has(scenery)).toBe(false);
    }
  });

  test('the engine has a real sentence for the ones a game produces', () => {
    // The loop prints `describeEvent(event)` for these. A type the engine had
    // no wording for would reach the player as an empty line.
    const state = refutationBetweenOthers();
    const seen = state.events.filter((event) => CRITICAL_EVENTS.has(event.type));
    expect(seen.length).toBeGreaterThan(0);
    for (const event of seen) {
      const sentence = describeEvent(event);
      console.log(`[critical events] ${event.type} -> ${sentence}`);
      expect(sentence.length).toBeGreaterThan(0);
      expect(sentence).toContain(' ');
    }
  });
});
