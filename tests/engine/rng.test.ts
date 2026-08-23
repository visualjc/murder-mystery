import { describe, expect, test } from 'bun:test';
import { createRng, nextFloat, nextInt, pick, rollDie, shuffle } from '../../src/engine/rng.ts';

describe('createRng', () => {
  test('the same numeric seed yields the same state', () => {
    expect(createRng(42)).toEqual(createRng(42));
  });

  test('the same string seed yields the same state, and differs from another string', () => {
    expect(createRng('murder')).toEqual(createRng('murder'));
    expect(createRng('murder').seed).not.toBe(createRng('mystery').seed);
  });

  test('a zero seed is normalized away from the degenerate all-zero state', () => {
    expect(createRng(0).seed).not.toBe(0);
  });

  test('a fractional seed is truncated to an integer state', () => {
    expect(createRng(7.9)).toEqual(createRng(7));
  });
});

describe('nextFloat', () => {
  test('returns a value in [0, 1) and a state that differs from the input', () => {
    const rng = createRng('float');
    const [value, next] = nextFloat(rng);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
    expect(next.seed).not.toBe(rng.seed);
  });

  test('is pure: the same state always produces the same draw', () => {
    const rng = createRng(99);
    expect(nextFloat(rng)).toEqual(nextFloat(rng));
  });

  test('a long run stays inside the unit interval and is not constant', () => {
    let state = createRng('run');
    const values: number[] = [];
    for (let i = 0; i < 500; i += 1) {
      const [value, next] = nextFloat(state);
      state = next;
      values.push(value);
    }
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(400);
  });
});

describe('nextInt', () => {
  test('stays inside [0, bound)', () => {
    let state = createRng('ints');
    for (let i = 0; i < 300; i += 1) {
      const [value, next] = nextInt(state, 9);
      state = next;
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(9);
    }
  });

  test('a bound of 1 always returns 0', () => {
    const [value] = nextInt(createRng('one'), 1);
    expect(value).toBe(0);
  });

  test('rejects a non-positive or non-integer bound', () => {
    expect(() => nextInt(createRng(1), 0)).toThrow(RangeError);
    expect(() => nextInt(createRng(1), -3)).toThrow(RangeError);
    expect(() => nextInt(createRng(1), 2.5)).toThrow(RangeError);
  });
});

describe('rollDie', () => {
  test('every roll is an integer in [1, 6]', () => {
    let state = createRng('dice');
    for (let i = 0; i < 600; i += 1) {
      const [value, next] = rollDie(state);
      state = next;
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
    }
  });

  test('all six faces appear across a long run', () => {
    let state = createRng('faces');
    const seen = new Set<number>();
    for (let i = 0; i < 300; i += 1) {
      const [value, next] = rollDie(state);
      state = next;
      seen.add(value);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('replays identically from the same seed', () => {
    const roll = (seed: string) => {
      let state = createRng(seed);
      return Array.from({ length: 20 }, () => {
        const [value, next] = rollDie(state);
        state = next;
        return value;
      });
    };
    expect(roll('replay')).toEqual(roll('replay'));
    expect(roll('replay')).not.toEqual(roll('other'));
  });
});

describe('pick', () => {
  test('returns an element of the list', () => {
    const items = ['a', 'b', 'c'];
    const [chosen] = pick(items, createRng('pick'));
    expect(items).toContain(chosen);
  });

  test('reaches every element eventually', () => {
    const items = ['a', 'b', 'c'];
    let state = createRng('coverage');
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      const [chosen, next] = pick(items, state);
      state = next;
      seen.add(chosen);
    }
    expect(seen.size).toBe(3);
  });

  test('throws on an empty list', () => {
    expect(() => pick([], createRng(1))).toThrow(RangeError);
  });
});

describe('shuffle', () => {
  test('is a permutation and does not mutate the input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const snapshot = input.slice();
    const [shuffled] = shuffle(input, createRng('shuffle'));
    expect(input).toEqual(snapshot);
    expect(shuffled.slice().sort((a, b) => a - b)).toEqual(snapshot);
  });

  test('actually reorders a reasonably long list', () => {
    const input = Array.from({ length: 21 }, (_unused, index) => index);
    const [shuffled] = shuffle(input, createRng('reorder'));
    expect(shuffled).not.toEqual(input);
  });

  test('is deterministic per seed', () => {
    const input = Array.from({ length: 18 }, (_unused, index) => index);
    const [a] = shuffle(input, createRng('deal'));
    const [b] = shuffle(input, createRng('deal'));
    const [c] = shuffle(input, createRng('deal-2'));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  test('handles empty and single-element lists', () => {
    expect(shuffle([], createRng(1))[0]).toEqual([]);
    expect(shuffle(['only'], createRng(1))[0]).toEqual(['only']);
  });
});
