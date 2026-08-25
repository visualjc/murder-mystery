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
import { describeEvent, playerView, visibleEvents } from '../../src/engine/view.ts';
import type { GameEvent, GameState } from '../../src/engine/types.ts';
import { CANNED_SCENARIO } from '../../src/gm/scenario.ts';
import { CRITICAL_EVENTS, narrateEvents, narrationMessages } from '../../src/gm/narrator.ts';
import { GameMaster } from '../../src/gm/index.ts';
import { completionResponse, errorResponse, startFakeVendor } from '../llm/fake-vendor.ts';
import { arrangedGame, standingInRoom } from '../engine/helpers.ts';
import { clientFor, narrationReply, promptTextOf } from './support.ts';

/** The events of a turn that the model is actually asked to narrate. */
function sceneryOf(events: readonly GameEvent[]): GameEvent[] {
  return events.filter((event) => !CRITICAL_EVENTS.has(event.type));
}

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
  test('one call per turn covers the scenery, and the engine keeps the rest', async () => {
    const events = turnEvents();
    const scenery = sceneryOf(events);
    // The fixture must exercise BOTH halves of the split, or it proves nothing.
    expect(scenery.length).toBeGreaterThan(0);
    expect(scenery.length).toBeLessThan(events.length);

    const vendor = startFakeVendor(() =>
      completionResponse({
        content: narrationReply(...scenery.map((_event, index) => `Line ${index} in a velvet voice.`)),
        usage: { prompt_tokens: 80, completion_tokens: 60, total_tokens: 140 },
      }),
    );
    try {
      const client = clientFor(vendor.baseUrl);
      const lines = await narrateEvents(client, { scenario: CANNED_SCENARIO, viewer: 'p1', events });
      console.log('[narration] lines ->', lines.map((line) => [line.source, line.text]));

      expect(vendor.requests).toHaveLength(1);
      // Every event still gets exactly one line, in the order it happened.
      expect(lines).toHaveLength(events.length);
      expect(lines.map((line) => line.event)).toEqual([...events]);

      let sceneryIndex = 0;
      for (const line of lines) {
        if (CRITICAL_EVENTS.has(line.event.type)) {
          // Deduction-bearing: the engine's words, marked as a deliberate
          // choice rather than a vendor failure.
          expect(line.source).toBe('engine');
          expect(line.text).toBe(describeEvent(line.event));
        } else {
          expect(line.source).toBe('llm');
          expect(line.text).toBe(`Line ${sceneryIndex} in a velvet voice.`);
          sceneryIndex += 1;
        }
      }

      // The prompt carries the engine's account of each SCENERY event, and no
      // account whatsoever of the critical ones.
      const prompt = promptTextOf(vendor.requests[0]!);
      for (const event of scenery) expect(prompt).toContain(describeEvent(event));
      for (const event of events) {
        if (CRITICAL_EVENTS.has(event.type)) expect(prompt).not.toContain(describeEvent(event));
      }
      expect(client.usage.total_tokens).toBe(140);
    } finally {
      await vendor.stop();
    }
  });

  test('a turn of nothing but critical events costs no call at all', async () => {
    const events = turnEvents().filter((event) => CRITICAL_EVENTS.has(event.type));
    expect(events.length).toBeGreaterThan(0);

    const vendor = startFakeVendor(() => completionResponse({ content: '[]' }));
    try {
      const client = clientFor(vendor.baseUrl);
      const lines = await narrateEvents(client, { scenario: CANNED_SCENARIO, viewer: 'p1', events });
      console.log('[narration all-critical] ->', lines.map((line) => [line.source, line.text]));

      expect(vendor.requests).toHaveLength(0);
      expect(client.usage.calls).toBe(0);
      expect(lines.map((line) => line.text)).toEqual(events.map(describeEvent));
      expect(lines.every((line) => line.source === 'engine')).toBe(true);
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
      console.log('[narration failed] ->', lines.map((line) => [line.source, line.text]));

      expect(lines).toHaveLength(events.length);
      lines.forEach((line, index) => {
        const event = events[index]!;
        expect(line.text).toBe(describeEvent(event));
        // Only the SCENERY failed. A critical event was never the vendor's to
        // deliver, so calling it a fallback would report an outage that did
        // not happen — and the UI raises its offline notice off exactly this.
        expect(line.source).toBe(CRITICAL_EVENTS.has(event.type) ? 'engine' : 'fallback');
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
      expect(
        lines.every((line) =>
          line.source === (CRITICAL_EVENTS.has(line.event.type) ? 'engine' : 'fallback'),
        ),
      ).toBe(true);
      expect(lines.map((line) => line.text)).toEqual(events.map(describeEvent));
    } finally {
      await vendor.stop();
    }
  });

  test('a short or ragged array falls back only for the entries it missed', async () => {
    const events = turnEvents();
    const scenery = sceneryOf(events);
    expect(scenery.length).toBeGreaterThan(1);

    const vendor = startFakeVendor(() =>
      completionResponse({ content: narrationReply('A hush falls.', '', 17) }),
    );
    try {
      const lines = await narrateEvents(clientFor(vendor.baseUrl), {
        scenario: CANNED_SCENARIO,
        viewer: 'p1',
        events,
      });
      console.log('[narration ragged] ->', lines.map((line) => [line.source, line.text]));

      // The slots line up with the SCENERY, in scenery order — the model was
      // never told about anything else, so it cannot be short by those.
      const narrated = lines.filter((line) => !CRITICAL_EVENTS.has(line.event.type));
      expect(narrated).toHaveLength(scenery.length);
      expect(narrated[0]!.text).toBe('A hush falls.');
      expect(narrated[0]!.source).toBe('llm');
      // An empty string and a number are not narration.
      for (let index = 1; index < narrated.length; index += 1) {
        expect(narrated[index]!.source).toBe('fallback');
        expect(narrated[index]!.text).toBe(describeEvent(narrated[index]!.event));
      }
      for (const line of lines.filter((entry) => CRITICAL_EVENTS.has(entry.event.type))) {
        expect(line.source).toBe('engine');
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
      completionResponse({ content: narrationReply('A card changes hands in silence.') }),
    );
    try {
      // A turn with scenery in it, so a request really is made and the prompt
      // is a thing that exists to inspect. Both refutation events are critical
      // and would never be sent on their own — the filter is what must hold
      // when the careless caller ALSO hands over something narratable.
      const scenery = sceneryOf(turnEvents())[0]!;
      expect(CRITICAL_EVENTS.has(scenery.type)).toBe(false);

      // The careless caller: the tail of the RAW log, unfiltered, for p1.
      const lines = await narrateEvents(clientFor(vendor.baseUrl), {
        scenario: CANNED_SCENARIO,
        viewer: 'p1',
        events: [scenery, refuted, shown],
      });
      const prompt = promptTextOf(vendor.requests[0]!);
      console.log('[narration viewer-filtered] prompt ->', prompt);

      expect(prompt).not.toContain('Reverend Green');
      // p1 may see the refutation happened, and it is told — in the engine's
      // own words, because it is deduction input the model never gets to phrase.
      expect(prompt).not.toContain(describeEvent(refuted));
      expect(lines).toHaveLength(2);
      expect(lines[0]!.event).toBe(scenery);
      expect(lines[0]!.text).toBe('A card changes hands in silence.');
      expect(lines[1]!.event).toBe(refuted);
      expect(lines[1]!.source).toBe('engine');
      expect(lines[1]!.text).toBe(describeEvent(refuted));
    } finally {
      await vendor.stop();
    }
  });

  test('an all-critical slice of the raw log makes no request whatsoever', async () => {
    const state = refutationBetweenOthers();
    const refuted = state.events.find((event) => event.type === 'suggestion-refuted')!;
    const shown = state.events.find((event) => event.type === 'refutation-card-shown')!;

    const vendor = startFakeVendor(() => completionResponse({ content: '[]' }));
    try {
      const lines = await narrateEvents(clientFor(vendor.baseUrl), {
        scenario: CANNED_SCENARIO,
        viewer: 'p1',
        events: [refuted, shown],
      });
      // p1 may not see `shown` at all, and `refuted` is the engine's to state:
      // nothing is left that a vendor could be asked about.
      console.log('[all-critical slice] requests ->', vendor.requests.length);
      expect(vendor.requests).toHaveLength(0);
      expect(lines).toHaveLength(1);
      expect(lines[0]!.event).toBe(refuted);
      expect(lines[0]!.source).toBe('engine');
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
/**
 * The narrator was writing "Player two moved from position sixteen-seven",
 * because that is `describeEvent`'s vocabulary read aloud: seat ids and grid
 * coordinates are the ENGINE's bookkeeping, and the prompt gave the model
 * nothing else to call people or places. Seating is public — it is already on
 * the player's own screen — so telling the model who is who leaks nothing.
 */
/**
 * Item nrntyese, found by driving a live game rather than by the suite.
 *
 * The reply used to be a bare array of strings, and an event's line was
 * whichever entry happened to sit at its index. Models do not honour that: in
 * the seed-42 live game one entry described a LATER event and the entry for
 * that later event came back unusable, so the screen carried the same fact
 * twice — once in the model's words, in the wrong place, and once as the
 * engine's fallback in the right one.
 *
 * The reply now labels each line with the number it answers, so an entry lands
 * on the event it names or on nothing at all.
 */
describe('narration lines are matched by label, not by position', () => {
  test('a line labelled for a later event lands on that event, and no other', async () => {
    const events = sceneryOf(turnEvents());
    expect(events.length).toBeGreaterThan(2);

    // The model answers line 3 first and never answers line 1: exactly the
    // shape that used to print event 3 twice.
    const vendor = startFakeVendor(() =>
      completionResponse({
        content: JSON.stringify([{ n: 3, text: 'The candlestick was discovered in the Dining Room.' }]),
      }),
    );
    try {
      const lines = await narrateEvents(clientFor(vendor.baseUrl), {
        scenario: CANNED_SCENARIO,
        viewer: 'p1',
        events,
      });
      console.log('[labelled reply] ->', lines.map((line) => [line.source, line.text]));

      expect(lines).toHaveLength(events.length);
      // The labelled line went where it said it was going.
      expect(lines[2]!.source).toBe('llm');
      expect(lines[2]!.text).toBe('The candlestick was discovered in the Dining Room.');
      // And every unanswered event fell back to the engine — once each.
      for (const index of [0, 1]) {
        expect(lines[index]!.source).toBe('fallback');
        expect(lines[index]!.text).toBe(describeEvent(events[index]!));
      }
      // The fact the model told is not ALSO told by the engine anywhere.
      const engineCopy = lines.filter((line) => line.text === describeEvent(events[2]!));
      expect(engineCopy).toHaveLength(0);
    } finally {
      await vendor.stop();
    }
  });

  test('labels outside the batch, repeated, or malformed are ignored', async () => {
    const events = sceneryOf(turnEvents());
    const vendor = startFakeVendor(() =>
      completionResponse({
        content: JSON.stringify([
          { n: 1, text: 'A hush fell over the hall.' },
          { n: 1, text: 'A second answer for the same line.' },
          { n: 99, text: 'A line for an event that is not in this batch.' },
          { n: 0, text: 'Numbering starts at one.' },
          { text: 'No label at all.' },
          'a bare string',
        ]),
      }),
    );
    try {
      const lines = await narrateEvents(clientFor(vendor.baseUrl), {
        scenario: CANNED_SCENARIO,
        viewer: 'p1',
        events,
      });
      console.log('[hostile labels] ->', lines.map((line) => [line.source, line.text]));

      expect(lines[0]!.source).toBe('llm');
      // First answer wins; a second answer for the same line cannot overwrite it.
      expect(lines[0]!.text).toBe('A hush fell over the hall.');
      for (let index = 1; index < lines.length; index += 1) {
        expect(lines[index]!.source).toBe('fallback');
        expect(lines[index]!.text).toBe(describeEvent(events[index]!));
      }
    } finally {
      await vendor.stop();
    }
  });

  test('the prompt asks for the label, and numbers the events it asks about', () => {
    const events = sceneryOf(turnEvents());
    const prompt = narrationMessages(CANNED_SCENARIO, events)
      .map((message) => message.content)
      .join('\n');
    console.log('[labelled prompt] ->', prompt);
    expect(prompt).toMatch(/"n"/);
    expect(prompt).toContain('1. ');
  });
});

describe('the narration prompt speaks the fiction, not the engine', () => {
  const ROSTER = [
    { id: 'p1' as const, character: 'Miss Scarlett' },
    { id: 'p2' as const, character: 'Colonel Mustard' },
  ];

  test('the roster is in the prompt, and seat ids and coordinates are forbidden', () => {
    const scenery = sceneryOf(turnEvents());
    const messages = narrationMessages(CANNED_SCENARIO, scenery, ROSTER);
    const prompt = messages.map((message) => message.content).join('\n');
    console.log('[narration prompt] ->', prompt);

    expect(prompt).toContain('p1 is Miss Scarlett');
    expect(prompt).toContain('p2 is Colonel Mustard');
    expect(prompt).toContain('Call people by their character name');
    expect(prompt).toMatch(/Never write a seat id/);
    expect(prompt).toMatch(/Never read out corridor coordinates/);
    expect(prompt).toContain('past tense');
  });

  test('the game master builds the roster from the view it was given', async () => {
    const state = createGame({ seed: 'roster', playerCount: 3 });
    const view = playerView(rollDice(state), 'p1');
    const vendor = startFakeVendor(() =>
      completionResponse({ content: narrationReply('The hall was still.') }),
    );
    try {
      const gm = new GameMaster(clientFor(vendor.baseUrl));
      await gm.narrate(view, sceneryOf(visibleEvents(rollDice(state), 'p1')).slice(0, 1));
      const prompt = promptTextOf(vendor.requests[0]!);
      console.log('[roster from view] ->', prompt.split('At the table:')[1]?.split('What just')[0]);

      expect(prompt).toContain(`${view.you} is ${view.character}`);
      for (const opponent of view.opponents) {
        expect(prompt).toContain(`${opponent.id} is ${opponent.character}`);
      }
    } finally {
      await vendor.stop();
    }
  });
});

describe('CRITICAL_EVENTS', () => {
  test('names every moment a player deduces from, and nothing that is only scenery', () => {
    console.log('[critical events] ->', [...CRITICAL_EVENTS].sort());
    expect([...CRITICAL_EVENTS].sort()).toEqual([
      'accusation-made',
      'game-over',
      'player-eliminated',
      'refutation-card-shown',
      'suggestion-made',
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

describe('CRITICAL_EVENTS — epic review round 2', () => {
  test('suggestion-made is authoritative: the suggested triple is deduction input a model may not rewrite', () => {
    console.log('[critical set] has suggestion-made ->', CRITICAL_EVENTS.has('suggestion-made'));
    expect(CRITICAL_EVENTS.has('suggestion-made')).toBe(true);
  });
});
