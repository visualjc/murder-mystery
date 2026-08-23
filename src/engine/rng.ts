/**
 * Seedable, purely functional random number generator.
 *
 * The engine must be replayable: the same seed and the same sequence of player
 * actions must produce byte-identical games. So the RNG is a *value* carried in
 * game state, not a hidden mutable object, and every draw returns the next
 * state alongside the number.
 *
 * Algorithm: mulberry32 — 32-bit, fast, well-distributed enough for a card
 * game, and short enough to audit by eye.
 */

export type RngState = { readonly seed: number };

/** Hash an arbitrary string seed into a 32-bit integer (FNV-1a). */
function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Create an RNG state from a numeric or string seed. */
export function createRng(seed: number | string): RngState {
  const numeric = typeof seed === 'number' ? Math.trunc(seed) : hashString(seed);
  // Avoid the all-zero state, which mulberry32 handles poorly.
  const normalized = (numeric >>> 0) === 0 ? 0x9e3779b9 : numeric >>> 0;
  return { seed: normalized };
}

/**
 * Draw the next float in [0, 1) and return it with the successor state.
 */
export function nextFloat(rng: RngState): [number, RngState] {
  let t = (rng.seed + 0x6d2b79f5) >>> 0;
  const next: RngState = { seed: t };
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

/**
 * Draw an integer in [0, boundExclusive).
 * Throws on a non-positive bound — an empty range is a caller bug, not a value.
 */
export function nextInt(rng: RngState, boundExclusive: number): [number, RngState] {
  if (!Number.isInteger(boundExclusive) || boundExclusive <= 0) {
    throw new RangeError(`nextInt bound must be a positive integer, got ${boundExclusive}`);
  }
  const [value, next] = nextFloat(rng);
  return [Math.floor(value * boundExclusive), next];
}

/** Roll one six-sided die: an integer in [1, 6]. */
export function rollDie(rng: RngState): [number, RngState] {
  const [value, next] = nextInt(rng, 6);
  return [value + 1, next];
}

/** Pick one element of a non-empty list. */
export function pick<T>(items: readonly T[], rng: RngState): [T, RngState] {
  if (items.length === 0) throw new RangeError('cannot pick from an empty list');
  const [index, next] = nextInt(rng, items.length);
  return [items[index] as T, next];
}

/**
 * Fisher-Yates shuffle. Returns a new array; the input is never mutated.
 */
export function shuffle<T>(items: readonly T[], rng: RngState): [T[], RngState] {
  const result = items.slice();
  let state = rng;
  for (let i = result.length - 1; i > 0; i -= 1) {
    const [j, next] = nextInt(state, i + 1);
    state = next;
    const a = result[i] as T;
    const b = result[j] as T;
    result[i] = b;
    result[j] = a;
  }
  return [result, state];
}
