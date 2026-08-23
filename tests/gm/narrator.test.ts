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
import type { GameEvent } from '../../src/engine/types.ts';
import { CANNED_SCENARIO } from '../../src/gm/scenario.ts';
import { narrateEvents } from '../../src/gm/narrator.ts';
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
      const lines = await narrateEvents(client, { scenario: CANNED_SCENARIO, events });
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
      const lines = await narrateEvents(client, { scenario: CANNED_SCENARIO, events: [] });
      expect(lines).toEqual([]);
      expect(vendor.requests).toHaveLength(0);
      expect(client.usage.calls).toBe(0);
    } finally {
      await vendor.stop();
    }
  });
});
