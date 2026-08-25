/**
 * The deterministic game engine.
 *
 * It owns every rule outcome — the deal, legal movement, suggestion validity,
 * refutation order and choice, accusation adjudication, win and loss — over a
 * plain state value, with no network, no clock and no LLM anywhere in it
 * (ADR-0001). Given a seed and a sequence of actions, the game replays exactly.
 */

export * from './cards.ts';
export * from './rng.ts';
export * from './board.ts';
export * from './types.ts';
export * from './setup.ts';
export * from './actions.ts';
export * from './view.ts';
